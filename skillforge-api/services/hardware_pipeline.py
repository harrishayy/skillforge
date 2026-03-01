"""
HARDWARE (webcam/guided) WORKFLOW PIPELINE — processes per-step video segments.

Supports two modes:
  A. INCREMENTAL (new): Steps are uploaded one at a time as the user finishes
     each step during recording. Each step is processed immediately with
     ordering guarantees (step N waits for step N-1).
  B. BATCH (legacy fallback): All step videos uploaded at once after recording.

Per-step pipeline:
  1. Extract key frames from the step video
  2. Refine voice transcript: audio → Parakeet ASR →
     Claude reconciles browser + server transcripts with workflow context
  3. Claude generates title, description, summary
  4. Multi-agent key object analysis with persistent memory:
     a. Build context chain (apparatus catalog + previous steps)
     b. Claude identifies N target objects per step
     c. Nemotron VL scans ALL frames for each target object
     d. SAM3 segments each object in its positive frames
  5. Write step context back to the memory layer for downstream steps
"""
import os
import re
import json
import asyncio
import traceback
from pathlib import Path
from models.database import execute, fetchone, fetchall, new_id, now_ms
from app_ws.pipeline_ws import broadcast
from services.video_processor import extract_frames, get_video_duration_ms
from services.key_object_pipeline import (
    run_key_object_analysis_multi,
    identify_key_objects,
    scan_frames_for_objects,
    segment_positive_frames_multi,
)
from services.memory_layer import (
    build_step_context,
    save_step_context,
    update_context_with_observations,
    get_apparatus_catalog,
)
from services.asr_service import extract_audio_from_video, transcribe_wav

UPLOADS_DIR = Path(__file__).parent.parent / "uploads"

DETECTION_RATE_MS = 2000  # ~1 detection frame per 2 seconds of video
MIN_DETECTION_FRAMES = 4
MAX_DETECTION_FRAMES = 16


def _detection_frame_budget(duration_ms: int) -> int:
    """Compute how many frames to send to the detection pipeline based on video length."""
    return min(MAX_DETECTION_FRAMES, max(MIN_DETECTION_FRAMES, duration_ms // DETECTION_RATE_MS))


def _subsample_frames(frame_paths: list[str], max_frames: int) -> list[str]:
    """Evenly subsample frame_paths down to *max_frames*, always keeping first and last."""
    if len(frame_paths) <= max_frames:
        return frame_paths
    indices = [round(i * (len(frame_paths) - 1) / (max_frames - 1)) for i in range(max_frames)]
    return [frame_paths[i] for i in dict.fromkeys(indices)]


async def _log(workflow_id: str, stage: str, message: str, progress: int):
    """Write a pipeline log entry and broadcast it."""
    entry_id = new_id()
    ts = now_ms()
    await execute(
        "INSERT INTO pipeline_logs (id, workflow_id, stage, message, progress, created_at) VALUES (?,?,?,?,?,?)",
        (entry_id, workflow_id, stage, message, progress, ts),
    )
    await broadcast(
        workflow_id,
        {
            "type": "pipeline_log",
            "stage": stage,
            "message": message,
            "progress": progress,
            "timestamp": ts,
        },
    )
    print(f"[HardwarePipeline:{workflow_id}] [{stage}] {message} ({progress}%)")


# ═══════════════════════════════════════════════════════════════════════════════
# INCREMENTAL PIPELINE — WorkflowPipelineManager + process_single_step
# ═══════════════════════════════════════════════════════════════════════════════

class WorkflowPipelineManager:
    """
    Per-workflow orchestrator for incremental step processing.

    Steps are enqueued as they arrive from the frontend and processed
    sequentially by a background worker. Ordering guarantees:
      - Apparatus analysis completes before any step starts
      - Step N-1 completes before step N starts (memory context dependency)
      - The "complete" event fires only after all steps are done AND finalize is called
    """
    _managers: dict[str, "WorkflowPipelineManager"] = {}

    def __init__(self, workflow_id: str):
        self.workflow_id = workflow_id
        self.step_queue: asyncio.Queue = asyncio.Queue()
        self.apparatus_done = asyncio.Event()
        self.has_apparatus = False
        self.steps_completed: dict[int, asyncio.Event] = {}
        self.refined_transcripts: list[str] = []
        self.steps_created = 0
        self.workflow_offset_ms = 0
        self.finalized = False
        self.total_steps: int | None = None
        self._worker_task: asyncio.Task | None = None

    @classmethod
    def get_or_create(cls, workflow_id: str) -> "WorkflowPipelineManager":
        if workflow_id not in cls._managers:
            mgr = cls(workflow_id)
            cls._managers[workflow_id] = mgr
            mgr._worker_task = asyncio.get_event_loop().create_task(mgr._worker_loop())
        return cls._managers[workflow_id]

    @classmethod
    def cleanup(cls, workflow_id: str):
        mgr = cls._managers.pop(workflow_id, None)
        if mgr and mgr._worker_task and not mgr._worker_task.done():
            mgr._worker_task.cancel()

    async def enqueue_apparatus(self, video_path: str):
        self.has_apparatus = True
        await self.step_queue.put(("apparatus", video_path))

    async def enqueue_step(self, step_number: int, video_path: str, transcript: str,
                           note: str, client_duration: int | None):
        self.steps_completed.setdefault(step_number, asyncio.Event())
        await self.step_queue.put(("step", {
            "step_number": step_number,
            "video_path": video_path,
            "transcript": transcript,
            "note": note,
            "client_duration": client_duration,
        }))

    async def finalize(self, total_steps: int):
        self.finalized = True
        self.total_steps = total_steps
        await self.step_queue.put(("finalize", total_steps))

    async def _worker_loop(self):
        """Process items from the queue sequentially."""
        wid = self.workflow_id
        try:
            if not self.has_apparatus:
                self.apparatus_done.set()

            while True:
                item_type, payload = await self.step_queue.get()

                if item_type == "apparatus":
                    await self._process_apparatus(payload)

                elif item_type == "step":
                    step_num = payload["step_number"]

                    # Wait for apparatus if present
                    if self.has_apparatus:
                        await self.apparatus_done.wait()

                    # Wait for previous step to complete (memory context ordering)
                    if step_num > 1:
                        prev_event = self.steps_completed.get(step_num - 1)
                        if prev_event:
                            await prev_event.wait()

                    await self._process_step(payload)

                elif item_type == "finalize":
                    total = payload
                    # Wait for all steps to finish
                    for sn in range(1, total + 1):
                        evt = self.steps_completed.get(sn)
                        if evt:
                            await evt.wait()

                    await execute(
                        "UPDATE workflows SET status='ready', total_steps=?, segmentation_status='processing', updated_at=? WHERE id=?",
                        (self.steps_created, now_ms(), wid),
                    )
                    await _log(wid, "complete", f"Workflow ready with {self.steps_created} steps", 100)
                    await broadcast(wid, {
                        "type": "complete",
                        "workflow_id": wid,
                        "total_steps": self.steps_created,
                    })

                    # Launch deferred SAM3 in background (non-blocking)
                    asyncio.get_event_loop().create_task(run_deferred_sam3(wid))

                    WorkflowPipelineManager.cleanup(wid)
                    return

        except asyncio.CancelledError:
            pass
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[PipelineManager ERROR] {wid}: {e}\n{tb}")
            await execute(
                "UPDATE workflows SET status='failed', updated_at=? WHERE id=?",
                (now_ms(), wid),
            )
            await _log(wid, "error", f"Pipeline failed: {str(e)}", 0)
            await broadcast(wid, {
                "type": "error",
                "stage": "pipeline",
                "message": str(e),
                "recoverable": False,
            })
            WorkflowPipelineManager.cleanup(wid)

    async def _process_apparatus(self, video_path: str):
        wid = self.workflow_id
        await _log(wid, "frame_extraction", "Analyzing apparatus showcase...", 1)
        try:
            from services.apparatus_pipeline import run_apparatus_analysis
            apparatus_objects = await run_apparatus_analysis(
                workflow_id=wid,
                apparatus_video_path=video_path,
                on_progress=lambda msg, pct: _log(wid, "frame_extraction", msg, max(1, min(pct // 5, 4))),
            )
            await _log(
                wid, "frame_extraction",
                f"Apparatus catalog: {len(apparatus_objects)} objects identified", 5,
            )
        except Exception as e:
            print(f"[PipelineManager] Apparatus analysis failed: {e}", flush=True)
            await _log(wid, "frame_extraction", "Apparatus analysis failed — continuing without catalog", 5)
        finally:
            self.apparatus_done.set()

    async def _process_step(self, payload: dict):
        wid = self.workflow_id
        step_num = payload["step_number"]
        try:
            result = await process_single_step(
                workflow_id=wid,
                step_number=step_num,
                video_path=payload["video_path"],
                transcript=payload["transcript"],
                note=payload["note"],
                client_duration=payload["client_duration"],
                previous_transcripts=list(self.refined_transcripts),
                workflow_offset_ms=self.workflow_offset_ms,
            )
            self.refined_transcripts.append(result["refined_transcript"])
            self.workflow_offset_ms += result["duration_ms"]
            self.steps_created += 1
        except Exception as e:
            print(f"[PipelineManager] Step {step_num} failed: {e}", flush=True)
            tb = traceback.format_exc()
            print(tb)
            self.refined_transcripts.append(payload["transcript"])
        finally:
            evt = self.steps_completed.setdefault(step_num, asyncio.Event())
            evt.set()


async def process_single_step(
    workflow_id: str,
    step_number: int,
    video_path: str,
    transcript: str,
    note: str,
    client_duration: int | None,
    previous_transcripts: list[str],
    workflow_offset_ms: int = 0,
) -> dict:
    """
    Process a single step through the full pipeline. Returns a result dict
    with refined_transcript and duration_ms for the manager to track.
    """
    wf = await execute_fetch_workflow(workflow_id)
    wf_title = wf.get("title", "") if wf else ""
    wf_description = wf.get("description", "") if wf else ""

    await _log(
        workflow_id, "frame_extraction",
        f"Step {step_number}: Extracting frames...",
        10 + step_number * 2,
    )

    # 1. Extract frames
    frames = await extract_frames(video_path, workflow_id, on_progress=None)
    duration_ms = get_video_duration_ms(video_path)
    if duration_ms == 0 and frames:
        duration_ms = frames[-1]["timestamp_ms"]
    if duration_ms == 0 and client_duration:
        duration_ms = client_duration

    mid_ms = duration_ms // 2
    key_frame = min(frames, key=lambda f: abs(f["timestamp_ms"] - mid_ms)) if frames else None
    relative_video_path = str(Path(video_path).relative_to(UPLOADS_DIR.parent))

    # Update workflow duration
    await execute(
        "UPDATE workflows SET duration_ms = COALESCE(duration_ms, 0) + ?, updated_at=? WHERE id=?",
        (duration_ms, now_ms(), workflow_id),
    )

    # 2. Refine transcript
    await _log(
        workflow_id, "claude_decompose",
        f"Step {step_number}: Refining transcript...",
        20 + step_number * 2,
    )
    apparatus_catalog = await get_apparatus_catalog(workflow_id)
    try:
        refined = await _refine_transcript(
            browser_transcript=transcript,
            video_path=video_path,
            step_number=step_number,
            workflow_title=wf_title,
            workflow_description=wf_description,
            apparatus_catalog=apparatus_catalog,
            previous_transcripts=previous_transcripts,
            note=note,
        )
    except Exception as e:
        print(f"[HardwarePipeline] Transcript refinement failed for step {step_number}: {e}", flush=True)
        refined = transcript

    # 3. Generate step metadata
    await _log(
        workflow_id, "claude_decompose",
        f"Step {step_number}: Generating title and description...",
        30 + step_number * 2,
    )
    title, description, ai_summary = await _generate_step_metadata(
        refined, step_number, note,
        workflow_title=wf_title,
        workflow_description=wf_description,
    )

    # 4. Insert step + step_frames into DB
    step_id = new_id()
    ts = now_ms()
    key_frame_path = key_frame["relative_path"] if key_frame else None
    wf_start = workflow_offset_ms
    wf_end = workflow_offset_ms + duration_ms

    await execute(
        """INSERT INTO steps
           (id, workflow_id, step_number, title, description,
            start_ms, end_ms, workflow_start_ms, workflow_end_ms,
            key_frame_path, video_path,
            ai_description, transcript, note,
            created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            step_id, workflow_id, step_number, title, description,
            wf_start, wf_end, wf_start, wf_end,
            key_frame_path, relative_video_path,
            ai_summary, refined, note,
            ts, ts,
        ),
    )

    key_frame_rel = key_frame["relative_path"] if key_frame else None
    frame_id_map: dict[str, str] = {}
    for frm in frames:
        frame_id = new_id()
        frame_id_map[frm["path"]] = frame_id
        await execute(
            """INSERT INTO step_frames
               (id, step_id, timestamp_ms, frame_path, is_key_frame, created_at)
               VALUES (?,?,?,?,?,?)""",
            (
                frame_id, step_id, frm["timestamp_ms"],
                frm["relative_path"],
                1 if frm["relative_path"] == key_frame_rel else 0,
                ts,
            ),
        )

    # 5. Claude identify + Nemotron scan (SAM3 segmentation is deferred)
    if frames:
        await _log(
            workflow_id, "nemotron_vl",
            f"Step {step_number}: Running multi-object detection...",
            50 + step_number * 3,
        )

        try:
            context = await build_step_context(workflow_id, step_number)

            all_frame_paths = [frm["path"] for frm in frames]
            budget = _detection_frame_budget(duration_ms)
            frame_paths = _subsample_frames(all_frame_paths, max_frames=budget)

            target_objects = await identify_key_objects(
                step_title=title,
                step_description=description,
                transcript=refined,
                note=note,
                context=context,
            )

            primary_obj = next(
                (o for o in target_objects if o["role"] == "primary"),
                target_objects[0] if target_objects else {"label": title, "sam3_prompt": title},
            )

            sam3_prompt = primary_obj.get("sam3_prompt", "")
            if sam3_prompt:
                await execute(
                    "UPDATE steps SET sam3_prompt=? WHERE id=?",
                    (sam3_prompt, step_id),
                )

            # Persist target objects for deferred SAM3
            await execute(
                "UPDATE steps SET target_objects_json=? WHERE id=?",
                (json.dumps(target_objects), step_id),
            )

            # Build Nemotron context
            nemotron_context_parts = []
            if title:
                nemotron_context_parts.append(f'Step: "{title}"')
            if description:
                nemotron_context_parts.append(f'Description: "{description}"')
            if refined:
                nemotron_context_parts.append(f'Expert narration: "{refined[:300]}"')
            nemotron_context = (
                "Context for this frame:\n" + "\n".join(f"- {p}" for p in nemotron_context_parts)
                if nemotron_context_parts else None
            )

            detection_results = await scan_frames_for_objects(
                frame_paths, target_objects, step_context=nemotron_context,
            )

            positive_counts = {}
            all_frame_detections = []
            for label, detections in detection_results.items():
                positive_counts[label] = sum(1 for d in detections if d["present"])
                for det in detections:
                    all_frame_detections.append(det)
                    fpath = det["frame_path"]
                    fid = frame_id_map.get(fpath)
                    if fid and det["present"]:
                        await execute(
                            "UPDATE step_frames SET object_detected=?, object_description=?, nemotron_center_x=?, nemotron_center_y=? WHERE id=?",
                            (1, det.get("description", ""), det.get("center_x"), det.get("center_y"), fid),
                        )

            # Context writeback to memory layer
            await update_context_with_observations(
                workflow_id=workflow_id,
                step_number=step_number,
                objects_identified=target_objects,
                frame_observations=all_frame_detections,
                new_observations=ai_summary or "",
            )

            # Build spatial descriptions for objects Nemotron detected
            segmented_labels: set[str] = set()
            spatial_descriptions: dict[str, str] = {}
            for obj in target_objects:
                label = obj.get("label", "")
                if label in segmented_labels:
                    continue
                if positive_counts.get(label, 0) == 0:
                    continue
                detections = detection_results.get(label, [])
                best_desc = max(
                    (d.get("description", "") for d in detections if d.get("present")),
                    key=len,
                    default="",
                )
                if best_desc:
                    spatial_descriptions[label] = best_desc

            if spatial_descriptions:
                hints = "\n".join(
                    f"- {label}: {desc}" for label, desc in spatial_descriptions.items()
                )
                addendum = f"\n\nLocation reference:\n{hints}"
                await execute(
                    "UPDATE steps SET ai_description = COALESCE(ai_description, '') || ? WHERE id=?",
                    (addendum, step_id),
                )

            total_pos = sum(positive_counts.values())
            obj_names = ", ".join(f'"{o["label"]}"' for o in target_objects)
            await _log(
                workflow_id, "nemotron_vl",
                f"Step {step_number}: {obj_names} — {total_pos} detections across {len(frame_paths)} frames",
                70 + step_number * 3,
            )

        except Exception as e:
            print(f"[HardwarePipeline] Key object analysis failed for step {step_number}: {e}")
            await _log(
                workflow_id, "nemotron_vl",
                f"Step {step_number}: Key object analysis failed — {e}",
                70 + step_number * 3,
            )

    # 6. Broadcast step_created
    await broadcast(workflow_id, {
        "type": "step_created",
        "step": {
            "id": step_id,
            "step_number": step_number,
            "title": title,
            "description": description,
            "start_ms": wf_start,
            "end_ms": wf_end,
            "workflow_start_ms": wf_start,
            "workflow_end_ms": wf_end,
            "key_frame_path": key_frame_path,
            "video_path": relative_video_path,
        },
    })

    await _log(
        workflow_id, "claude_decompose",
        f"Step {step_number} created: \"{title}\"",
        75 + step_number * 3,
    )

    return {
        "step_id": step_id,
        "refined_transcript": refined,
        "duration_ms": duration_ms,
        "title": title,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# BATCH PIPELINE — legacy fallback (upload-steps endpoint)
# ═══════════════════════════════════════════════════════════════════════════════

async def run_hardware_pipeline(
    workflow_id: str,
    step_video_paths: list[str],
    step_transcripts: list[str],
    step_notes: list[str] | None = None,
    client_durations: list[int] | None = None,
    apparatus_video_path: str | None = None,
):
    """
    BATCH mode: Process all per-step video segments at once.
    Kept as fallback for the legacy upload-steps endpoint and crash recovery.
    """
    step_notes = step_notes or []
    total_steps = len(step_video_paths)

    wf = await execute_fetch_workflow(workflow_id)
    wf_title = wf.get("title", "") if wf else ""
    wf_description = wf.get("description", "") if wf else ""

    try:
        # ── Apparatus showcase analysis (if video provided) ──────────────
        if apparatus_video_path:
            await _log(workflow_id, "frame_extraction", "Analyzing apparatus showcase...", 1)
            try:
                from services.apparatus_pipeline import run_apparatus_analysis
                apparatus_objects = await run_apparatus_analysis(
                    workflow_id=workflow_id,
                    apparatus_video_path=apparatus_video_path,
                    on_progress=lambda msg, pct: _log(workflow_id, "frame_extraction", msg, max(1, min(pct // 5, 4))),
                )
                await _log(
                    workflow_id, "frame_extraction",
                    f"Apparatus catalog: {len(apparatus_objects)} objects identified", 5,
                )
            except Exception as e:
                print(f"[HardwarePipeline] Apparatus analysis failed: {e}", flush=True)
                await _log(workflow_id, "frame_extraction", "Apparatus analysis failed — continuing without catalog", 5)

        await _log(workflow_id, "frame_extraction", f"Processing {total_steps} step videos...", 5)

        # Process each step sequentially through the full pipeline
        refined_transcripts: list[str] = []
        steps_created = 0
        workflow_offset_ms = 0

        for i, video_path in enumerate(step_video_paths):
            step_num = i + 1
            t = step_transcripts[i] if i < len(step_transcripts) else ""
            n = step_notes[i] if i < len(step_notes) else ""
            dur = client_durations[i] if client_durations and i < len(client_durations) else None

            try:
                result = await process_single_step(
                    workflow_id=workflow_id,
                    step_number=step_num,
                    video_path=video_path,
                    transcript=t,
                    note=n,
                    client_duration=dur,
                    previous_transcripts=list(refined_transcripts),
                    workflow_offset_ms=workflow_offset_ms,
                )
                refined_transcripts.append(result["refined_transcript"])
                workflow_offset_ms += result["duration_ms"]
                steps_created += 1
            except Exception as e:
                print(f"[HardwarePipeline] Step {step_num} failed: {e}", flush=True)
                refined_transcripts.append(t)

        # ── Finalize ──────────────────────────────────────────────────────
        await execute(
            "UPDATE workflows SET status='ready', total_steps=?, segmentation_status='processing', updated_at=? WHERE id=?",
            (steps_created, now_ms(), workflow_id),
        )

        await _log(workflow_id, "complete", f"Workflow ready with {steps_created} steps", 100)
        await broadcast(
            workflow_id,
            {
                "type": "complete",
                "workflow_id": workflow_id,
                "total_steps": steps_created,
            },
        )

        # Launch deferred SAM3 in background (non-blocking)
        asyncio.get_event_loop().create_task(run_deferred_sam3(workflow_id))

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[HardwarePipeline ERROR] {e}\n{tb}")
        await execute(
            "UPDATE workflows SET status='failed', updated_at=? WHERE id=?",
            (now_ms(), workflow_id),
        )
        await _log(workflow_id, "error", f"Pipeline failed: {str(e)}", 0)
        await broadcast(
            workflow_id,
            {
                "type": "error",
                "stage": "pipeline",
                "message": str(e),
                "recoverable": False,
            },
        )


# ═══════════════════════════════════════════════════════════════════════════════
# DEFERRED SAM3 SEGMENTATION — runs after all steps reach "ready"
# ═══════════════════════════════════════════════════════════════════════════════

async def run_deferred_sam3(workflow_id: str):
    """
    Background task: run SAM3 segmentation across all steps with an expanded
    frame budget after the workflow reaches "ready" status. Uses ALL extracted
    frames (not the subsampled budget) for dramatically better coverage.
    """
    import base64 as b64mod
    from services.sam3_service import generate_segmented_image

    try:
        await execute(
            "UPDATE workflows SET segmentation_status='processing', updated_at=? WHERE id=?",
            (now_ms(), workflow_id),
        )
        await _log(workflow_id, "nemotron_vl", "Deferred SAM3 segmentation starting...", 80)

        steps = await fetchall(
            "SELECT id, step_number, title, description, transcript, target_objects_json, sam3_prompt "
            "FROM steps WHERE workflow_id=? ORDER BY step_number",
            (workflow_id,),
        )

        total_segments = 0
        for step_row in steps:
            step_id = step_row["id"]
            step_num = step_row["step_number"]
            target_json = step_row.get("target_objects_json")

            if not target_json:
                continue

            try:
                target_objects = json.loads(target_json)
            except (json.JSONDecodeError, TypeError):
                continue

            if not target_objects:
                continue

            primary_obj = next(
                (o for o in target_objects if o.get("role") == "primary"),
                target_objects[0],
            )

            # Load ALL frames for this step (expanded budget)
            step_frames = await fetchall(
                "SELECT id, frame_path, object_detected, nemotron_center_x, nemotron_center_y "
                "FROM step_frames WHERE step_id=? ORDER BY timestamp_ms",
                (step_id,),
            )

            if not step_frames:
                continue

            # Resolve absolute paths for frames
            frame_abs_paths = [str(UPLOADS_DIR.parent / f["frame_path"]) for f in step_frames]
            frame_id_lookup: dict[str, str] = {}
            for i, sf in enumerate(step_frames):
                frame_id_lookup[frame_abs_paths[i]] = sf["id"]

            # Run Nemotron on expanded frame set (all frames, not just subsampled)
            nemotron_context_parts = []
            if step_row.get("title"):
                nemotron_context_parts.append(f'Step: "{step_row["title"]}"')
            if step_row.get("description"):
                nemotron_context_parts.append(f'Description: "{step_row["description"]}"')
            if step_row.get("transcript"):
                nemotron_context_parts.append(f'Expert narration: "{step_row["transcript"][:300]}"')
            nemotron_context = (
                "Context for this frame:\n" + "\n".join(f"- {p}" for p in nemotron_context_parts)
                if nemotron_context_parts else None
            )

            detection_results = await scan_frames_for_objects(
                frame_abs_paths, target_objects, step_context=nemotron_context,
            )

            # Update step_frames with expanded Nemotron results
            for label, detections in detection_results.items():
                for det in detections:
                    fid = frame_id_lookup.get(det["frame_path"])
                    if fid and det["present"]:
                        await execute(
                            "UPDATE step_frames SET object_detected=1, object_description=?, nemotron_center_x=?, nemotron_center_y=? WHERE id=?",
                            (det.get("description", ""), det.get("center_x"), det.get("center_y"), fid),
                        )

            # Run SAM3 segmentation on all positive frames
            segmentations = await segment_positive_frames_multi(
                frame_abs_paths, target_objects, detection_results,
            )

            # Store click_targets and masks
            masks_dir = UPLOADS_DIR / workflow_id / "masks" / step_id
            masks_dir.mkdir(parents=True, exist_ok=True)
            seg_dir = UPLOADS_DIR / workflow_id / "segmented" / step_id

            seg_by_frame: dict[str, list[dict]] = {}
            for seg_result in segmentations:
                seg_frame_abs = seg_result.get("frame_path", "")
                seg_frame_rel = str(Path(seg_frame_abs).relative_to(UPLOADS_DIR.parent)) if seg_frame_abs else None

                if seg_frame_abs:
                    seg_by_frame.setdefault(seg_frame_abs, []).extend(seg_result["segments"])

                for seg in seg_result["segments"]:
                    bbox = seg.get("bbox", [0, 0, 0, 0])
                    ct_id = new_id()
                    seg_label = seg.get("label", primary_obj.get("label", ""))
                    seg_role = seg.get("role", "primary")
                    is_primary = 1 if seg_role == "primary" else 0

                    mask_path = None
                    mask_b64 = seg.get("mask_base64")
                    if mask_b64:
                        mask_file = masks_dir / f"{ct_id}.png"
                        mask_file.write_bytes(b64mod.b64decode(mask_b64))
                        mask_path = str(mask_file.relative_to(UPLOADS_DIR.parent))

                    await execute(
                        """INSERT INTO click_targets
                           (id, step_id, element_text, element_type,
                            bbox_x, bbox_y, bbox_width, bbox_height,
                            action, confidence, is_primary, mask_path, frame_path, role)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            ct_id, step_id,
                            seg_label,
                            primary_obj.get("object_type", "other"),
                            bbox[0] * 100, bbox[1] * 100,
                            (bbox[2] - bbox[0]) * 100, (bbox[3] - bbox[1]) * 100,
                            "left_click", seg.get("score", 0), is_primary,
                            mask_path, seg_frame_rel, seg_role,
                        ),
                    )
                    total_segments += 1

            # Generate segmented overlay images
            for frame_abs, segs in seg_by_frame.items():
                fid = frame_id_lookup.get(frame_abs)
                if not fid or not segs:
                    continue
                out_file = seg_dir / f"{fid}.jpg"
                result_path = generate_segmented_image(
                    frame_abs, segs, str(out_file),
                )
                if result_path:
                    seg_rel = str(Path(result_path).relative_to(UPLOADS_DIR.parent))
                    await execute(
                        "UPDATE step_frames SET segmented_frame_path=? WHERE id=?",
                        (seg_rel, fid),
                    )

            await _log(
                workflow_id, "nemotron_vl",
                f"Step {step_num}: SAM3 segmented {sum(len(s['segments']) for s in segmentations)} objects",
                85 + step_num,
            )

        await execute(
            "UPDATE workflows SET segmentation_status='ready', updated_at=? WHERE id=?",
            (now_ms(), workflow_id),
        )
        await _log(workflow_id, "complete", f"SAM3 segmentation complete — {total_segments} total segments", 100)
        await broadcast(workflow_id, {
            "type": "segmentation_complete",
            "workflow_id": workflow_id,
            "total_segments": total_segments,
        })

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[DeferredSAM3 ERROR] {workflow_id}: {e}\n{tb}")
        await execute(
            "UPDATE workflows SET segmentation_status='failed', updated_at=? WHERE id=?",
            (now_ms(), workflow_id),
        )
        await _log(workflow_id, "error", f"SAM3 segmentation failed: {str(e)}", 0)
        await broadcast(workflow_id, {
            "type": "segmentation_failed",
            "workflow_id": workflow_id,
            "message": str(e),
        })


# ═══════════════════════════════════════════════════════════════════════════════
# SHARED HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

async def execute_fetch_workflow(workflow_id: str) -> dict | None:
    """Fetch workflow row for context (avoids circular import with database)."""
    from models.database import fetchone
    return await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))


async def _refine_transcript(
    browser_transcript: str,
    video_path: str,
    step_number: int,
    workflow_title: str = "",
    workflow_description: str = "",
    apparatus_catalog: list[dict] | None = None,
    previous_transcripts: list[str] | None = None,
    note: str = "",
) -> str:
    """
    Produce a refined transcript by:
      1. Extracting audio from the step video → Parakeet server transcript
      2. Sending both transcripts + context to Claude for reconciliation

    Falls back to the browser transcript if any step fails.
    """
    browser_text = browser_transcript.strip()

    server_text = ""
    wav_bytes = extract_audio_from_video(video_path)
    if wav_bytes:
        try:
            server_text = await transcribe_wav(wav_bytes)
        except Exception as e:
            print(f"[HardwarePipeline] Parakeet transcription failed for step {step_number}: {e}", flush=True)
        if server_text:
            print(
                f'[HardwarePipeline] Step {step_number} Parakeet transcript: "{server_text[:100]}"',
                flush=True,
            )

    if not browser_text and not server_text:
        return browser_text
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return server_text or browser_text

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        user_content = ""
        if workflow_title:
            user_content += f'Workflow: "{workflow_title}"'
            if workflow_description:
                user_content += f"\nDescription: {workflow_description}"
            user_content += "\n\n"

        if apparatus_catalog:
            obj_names = [o.get("object_name", "") for o in apparatus_catalog if o.get("object_name")]
            if obj_names:
                user_content += f"Known tools/parts in this workflow: {', '.join(obj_names)}\n\n"

        if previous_transcripts:
            summaries = [
                f"Step {i + 1}: {t[:120]}"
                for i, t in enumerate(previous_transcripts) if t.strip()
            ]
            if summaries:
                user_content += "Previous steps:\n" + "\n".join(summaries) + "\n\n"

        user_content += f"This is step {step_number}.\n\n"
        user_content += f'Browser speech recognition (Chrome Web Speech API): "{browser_text}"\n'
        if server_text:
            user_content += f'Server ASR (NVIDIA Parakeet CTC 1.1B): "{server_text}"\n'
        if note.strip():
            user_content += f'Expert note (typed, reliable): "{note.strip()}"\n'
        user_content += "\nProduce the refined transcript."

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10000,
            system=(
                "You are a transcript refinement assistant. You receive one or two speech-to-text "
                "transcripts of the same audio (from different ASR engines) along with contextual "
                "information about the workflow being recorded.\n\n"
                "Your job is to produce ONE clean, accurate transcript that represents what the "
                "expert actually said. Rules:\n"
                "- Cross-reference both transcripts to resolve ambiguities and correct ASR errors.\n"
                "- Use the workflow context (title, known objects/tools, previous steps) to fix "
                "domain-specific words that ASR commonly mangles (e.g. tool names, technical terms).\n"
                "- Remove filler words (um, uh, like, so, you know) and false starts.\n"
                "- Fix punctuation and capitalization.\n"
                "- Preserve the expert's actual words and meaning — do NOT rephrase or summarize.\n"
                "- If the expert gives a voice command (e.g. 'next step', 'object done'), "
                "exclude it from the transcript.\n"
                "- Reply with ONLY the refined transcript text, nothing else."
            ),
            messages=[{"role": "user", "content": user_content}],
        )

        refined = response.content[0].text.strip()
        if refined and len(refined) >= 3:
            return refined

    except Exception as e:
        print(f"[HardwarePipeline] Transcript refinement failed: {e}", flush=True)

    return server_text or browser_text


async def _generate_step_metadata(
    transcript: str,
    step_number: int,
    note: str = "",
    total_steps: int = 0,
    workflow_title: str = "",
    workflow_description: str = "",
) -> tuple[str, str, str]:
    """
    Use Claude to generate a concise title, imperative description, and
    an overall summary from the expert's voice transcript and optional notes.
    Falls back to generic text if the API call fails.

    Returns (title, description, ai_summary).
    """
    combined = " ".join(filter(None, [transcript.strip(), note.strip()]))
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or not combined:
        return (
            f"Step {step_number}",
            combined or f"Perform step {step_number}",
            "",
        )

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        user_content = ""
        if workflow_title:
            user_content += f'Workflow: "{workflow_title}"'
            if workflow_description:
                user_content += f"\nWorkflow description: {workflow_description}"
            user_content += "\n\n"
        if total_steps > 0:
            user_content += f"This is step {step_number} of {total_steps}.\n"
        user_content += f'Expert transcript (speech-to-text, may contain errors): "{transcript}"'
        if note.strip():
            user_content += f'\nExpert note (manually typed, reliable): "{note.strip()}"'
        user_content += "\n\nGenerate the title, description, and summary JSON."

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            system=(
                "You generate step metadata for a hands-on tutorial/workflow. "
                "The input comes from an expert recording themselves performing a task. "
                "The transcript is from speech-to-text and may contain ASR artifacts "
                "(misheard words, missing punctuation, filler words like 'um', 'uh', 'so'). "
                "Expert notes, when present, are typed manually and should be treated as more reliable than the transcript.\n\n"
                "Reply ONLY with valid JSON (no markdown fences):\n"
                '{"title": "...", "description": "...", "summary": "..."}\n\n'
                "TITLE rules:\n"
                "- Max 8 words. No step number prefix (e.g. NOT 'Step 1: ...').\n"
                "- Use a clear noun phrase or short verb phrase that names the action.\n"
                "- Focus on WHAT is being done, not HOW (e.g. 'Attach the ground wire' not 'Use pliers to grab wire').\n"
                "- If the transcript is too vague to extract a meaningful title, use the expert note or workflow context.\n\n"
                "DESCRIPTION rules:\n"
                "- 1-2 sentences, imperative mood, starting with a verb.\n"
                "- Written for the trainee: tell them exactly what to do and any critical details (tool, location, direction, force).\n"
                "- Include safety callouts if the expert mentions them.\n"
                "- Do NOT parrot the transcript verbatim — clean up, clarify, and distill.\n\n"
                "SUMMARY rules:\n"
                "- 1-3 sentences combining ALL available context (transcript + notes + workflow context).\n"
                "- Objective narration of what the expert does and why.\n"
                "- Mention specific tools, parts, or settings referenced by the expert.\n"
                "- If the transcript is very short or unclear, say so briefly rather than inventing detail."
            ),
            messages=[{
                "role": "user",
                "content": user_content,
            }],
        )

        text = response.content[0].text.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        json_match = re.search(r"\{.*\}", text, re.DOTALL)
        if not json_match:
            raise ValueError(f"No JSON object in Claude response: {text[:200]}")
        data = json.loads(json_match.group())

        title = (data.get("title") or "").strip()
        description = (data.get("description") or "").strip()
        summary = (data.get("summary") or "").strip()

        if not title or len(title) < 3:
            title = f"Step {step_number}"
        if not description:
            description = transcript.strip() or f"Perform step {step_number}"

        return (title, description, summary)

    except Exception as e:
        print(f"[HardwarePipeline] Claude metadata generation failed: {e}")
        title = transcript.strip()[:60] or f"Step {step_number}"
        return (title, transcript.strip() or f"Perform step {step_number}", "")
