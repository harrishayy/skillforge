"""
HARDWARE (webcam/guided) WORKFLOW PIPELINE — processes per-step video segments.

Each step arrives as its own video file. The pipeline:
  1. Extracts key frames from each step video
  2. Uses Claude to generate titles and descriptions per step
  3. Runs multi-agent key object analysis:
     a. Claude identifies the key object from step context
     b. Nemotron VL scans ALL frames for object presence
     c. SAM3 segments the object in frames where it was found

Called as a FastAPI BackgroundTask from routers/recording.py (upload-steps endpoint).
"""
import os
import json
from pathlib import Path
from models.database import execute, fetchall, new_id, now_ms
from websockets.pipeline_ws import broadcast
from services.video_processor import extract_frames, get_video_duration_ms
from services.key_object_pipeline import run_key_object_analysis

UPLOADS_DIR = Path(__file__).parent.parent / "uploads"


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


async def run_hardware_pipeline(
    workflow_id: str,
    step_video_paths: list[str],
    step_transcripts: list[str],
    step_notes: list[str] | None = None,
):
    """
    Process per-step video segments for a hardware/webcam guided recording.
    Each video file corresponds to one step (ordered by step number).
    """
    step_notes = step_notes or []
    total_steps = len(step_video_paths)

    # Fetch workflow-level context for the multi-agent pipeline
    wf = await execute_fetch_workflow(workflow_id)
    wf_title = wf.get("title", "") if wf else ""
    wf_description = wf.get("description", "") if wf else ""

    try:
        await _log(workflow_id, "frame_extraction", f"Processing {total_steps} step videos...", 2)

        total_duration_ms = 0
        step_data: list[dict] = []

        for i, video_path in enumerate(step_video_paths):
            step_num = i + 1
            pct_base = int((i / total_steps) * 30) + 5
            transcript = step_transcripts[i] if i < len(step_transcripts) else ""
            note = step_notes[i] if i < len(step_notes) else ""

            await _log(
                workflow_id, "frame_extraction",
                f"Extracting frames from step {step_num}/{total_steps}...", pct_base,
            )

            frames = await extract_frames(video_path, workflow_id, on_progress=None)
            duration_ms = get_video_duration_ms(video_path)
            total_duration_ms += duration_ms

            mid_ms = duration_ms // 2
            key_frame = min(frames, key=lambda f: abs(f["timestamp_ms"] - mid_ms)) if frames else None

            step_data.append({
                "step_number": step_num,
                "video_path": video_path,
                "relative_video_path": str(Path(video_path).relative_to(UPLOADS_DIR.parent)),
                "duration_ms": duration_ms,
                "frames": frames,
                "key_frame": key_frame,
                "transcript": transcript,
                "note": note,
            })

        await execute(
            "UPDATE workflows SET duration_ms=?, updated_at=? WHERE id=?",
            (total_duration_ms, now_ms(), workflow_id),
        )
        await _log(workflow_id, "frame_extraction", "Frame extraction complete", 35)

        # ── Claude step annotation ────────────────────────────────────────────
        await _log(workflow_id, "claude_decompose", "Generating step titles and annotations...", 40)

        steps_created = 0
        for sd in step_data:
            step_num = sd["step_number"]
            pct = 40 + int((step_num / total_steps) * 15)

            title, description, ai_summary = await _generate_step_metadata(
                sd["transcript"], step_num, sd["note"],
            )

            step_id = new_id()
            ts = now_ms()
            key_frame_path = sd["key_frame"]["relative_path"] if sd["key_frame"] else None

            await execute(
                """INSERT INTO steps
                   (id, workflow_id, step_number, title, description,
                    start_ms, end_ms, key_frame_path, video_path,
                    ai_description, transcript, note,
                    created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    step_id, workflow_id, step_num, title, description,
                    0, sd["duration_ms"],
                    key_frame_path, sd["relative_video_path"],
                    ai_summary, sd["transcript"], sd["note"],
                    ts, ts,
                ),
            )
            steps_created += 1

            # Store all extracted frames in step_frames table
            key_frame_rel = sd["key_frame"]["relative_path"] if sd["key_frame"] else None
            frame_id_map: dict[str, str] = {}
            for frm in sd["frames"]:
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

            # ── Multi-agent key object analysis ───────────────────────────────
            if sd["frames"]:
                await _log(
                    workflow_id, "nemotron_vl",
                    f"Step {step_num}: Running key object detection...",
                    55 + int((step_num / total_steps) * 30),
                )

                try:
                    frame_paths = [frm["path"] for frm in sd["frames"]]
                    analysis = await run_key_object_analysis(
                        frame_paths=frame_paths,
                        step_title=title,
                        step_description=description,
                        transcript=sd["transcript"],
                        note=sd["note"],
                        workflow_title=wf_title,
                        workflow_description=wf_description,
                    )

                    # Store sam3_prompt from Claude's key object identification
                    key_obj = analysis["key_object"]
                    sam3_prompt = key_obj.get("sam3_prompt", "")
                    if sam3_prompt:
                        await execute(
                            "UPDATE steps SET sam3_prompt=? WHERE id=?",
                            (sam3_prompt, step_id),
                        )

                    # Update step_frames with per-frame detection results
                    for detection in analysis["frame_detections"]:
                        fpath = detection["frame_path"]
                        fid = frame_id_map.get(fpath)
                        if fid:
                            await execute(
                                "UPDATE step_frames SET object_detected=?, object_description=? WHERE id=?",
                                (
                                    1 if detection["present"] else 0,
                                    detection.get("description", ""),
                                    fid,
                                ),
                            )

                    # Store SAM3 segmentation results as click_targets
                    for seg_result in analysis["segmentations"]:
                        for seg in seg_result["segments"]:
                            bbox = seg.get("bbox", [0, 0, 0, 0])
                            ct_id = new_id()
                            await execute(
                                """INSERT INTO click_targets
                                   (id, step_id, element_text, element_type,
                                    bbox_x, bbox_y, bbox_width, bbox_height,
                                    action, confidence, is_primary)
                                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                                (
                                    ct_id, step_id,
                                    key_obj.get("key_object", title),
                                    key_obj.get("object_type", "other"),
                                    bbox[0] * 100, bbox[1] * 100,
                                    (bbox[2] - bbox[0]) * 100, (bbox[3] - bbox[1]) * 100,
                                    "left_click", seg.get("score", 0), 0,
                                ),
                            )

                    pos = analysis["positive_frame_count"]
                    tot = analysis["total_frame_count"]
                    await _log(
                        workflow_id, "nemotron_vl",
                        f'Step {step_num}: "{key_obj["key_object"]}" found in {pos}/{tot} frames',
                        55 + int((step_num / total_steps) * 35),
                    )

                except Exception as e:
                    print(f"[HardwarePipeline] Key object analysis failed for step {step_num}: {e}")
                    await _log(
                        workflow_id, "nemotron_vl",
                        f"Step {step_num}: Key object analysis failed — {e}",
                        55 + int((step_num / total_steps) * 35),
                    )

            await broadcast(workflow_id, {
                "type": "step_created",
                "step": {
                    "id": step_id,
                    "step_number": step_num,
                    "title": title,
                    "description": description,
                    "start_ms": 0,
                    "end_ms": sd["duration_ms"],
                    "key_frame_path": key_frame_path,
                    "video_path": sd["relative_video_path"],
                },
            })

            await _log(
                workflow_id, "claude_decompose",
                f"Step {step_num} created: \"{title}\"",
                55 + int((step_num / total_steps) * 35),
            )

        # ── Finalize ──────────────────────────────────────────────────────────
        await execute(
            "UPDATE workflows SET status='ready', total_steps=?, updated_at=? WHERE id=?",
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

    except Exception as e:
        import traceback
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


async def execute_fetch_workflow(workflow_id: str) -> dict | None:
    """Fetch workflow row for context (avoids circular import with database)."""
    from models.database import fetchone
    return await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))


async def _generate_step_metadata(
    transcript: str,
    step_number: int,
    note: str = "",
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

        user_content = f"Step {step_number} transcript: \"{transcript}\""
        if note.strip():
            user_content += f"\nExpert note: \"{note.strip()}\""
        user_content += "\n\nGenerate the title, description, and summary JSON."

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            system=(
                "You generate concise step metadata for a tutorial. "
                "Reply ONLY with valid JSON: {\"title\": \"...\", \"description\": \"...\", \"summary\": \"...\"}\n"
                "Title: max 8 words, no step number prefix.\n"
                "Description: direct imperative instruction starting with a verb.\n"
                "Summary: 1-2 sentence overview of what happens in this step, combining the transcript context and any expert notes."
            ),
            messages=[{
                "role": "user",
                "content": user_content,
            }],
        )

        text = response.content[0].text.strip()
        data = json.loads(text)
        return (
            data.get("title", f"Step {step_number}"),
            data.get("description", transcript.strip()),
            data.get("summary", ""),
        )
    except Exception as e:
        print(f"[HardwarePipeline] Claude metadata generation failed: {e}")
        title = transcript.strip()[:60] or f"Step {step_number}"
        return (title, transcript.strip() or f"Perform step {step_number}", "")
