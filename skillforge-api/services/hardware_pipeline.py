"""
HARDWARE (webcam/guided) WORKFLOW PIPELINE — processes per-step video segments.

Each step arrives as its own video file. The pipeline:
  1. (Optional) Runs apparatus showcase analysis to build object catalog
  2. Extracts key frames from each step video
  2b. Refines voice transcript: extracts audio from video → Parakeet ASR →
     Claude reconciles browser + server transcripts with workflow context
  3. Uses Claude to generate titles and descriptions per step
  4. Runs multi-agent key object analysis with persistent memory:
     a. Builds context chain (apparatus catalog + previous steps)
     b. Claude identifies N target objects per step
     c. Nemotron VL scans ALL frames for each target object
     d. SAM3 segments each object in its positive frames
  5. Writes step context back to the memory layer for downstream steps

Called as a FastAPI BackgroundTask from routers/recording.py (upload-steps endpoint).
"""
import os
import re
import json
from pathlib import Path
from models.database import execute, fetchone, new_id, now_ms
from app_ws.pipeline_ws import broadcast
from services.video_processor import extract_frames, get_video_duration_ms
from services.key_object_pipeline import run_key_object_analysis_multi
from services.memory_layer import (
    build_step_context,
    save_step_context,
    update_context_with_observations,
    get_apparatus_catalog,
)
from services.asr_service import extract_audio_from_video, transcribe_wav

UPLOADS_DIR = Path(__file__).parent.parent / "uploads"

DETECTION_RATE_MS = 2500  # ~1 detection frame per 2.5 seconds of video
MIN_DETECTION_FRAMES = 3
MAX_DETECTION_FRAMES = 15


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


async def run_hardware_pipeline(
    workflow_id: str,
    step_video_paths: list[str],
    step_transcripts: list[str],
    step_notes: list[str] | None = None,
    client_durations: list[int] | None = None,
    apparatus_video_path: str | None = None,
):
    """
    Process per-step video segments for a hardware/webcam guided recording.
    Each video file corresponds to one step (ordered by step number).
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
                await _log(workflow_id, "frame_extraction", f"Apparatus analysis failed — continuing without catalog", 5)

        await _log(workflow_id, "frame_extraction", f"Processing {total_steps} step videos...", 5)

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
            if duration_ms == 0 and frames:
                duration_ms = frames[-1]["timestamp_ms"]
            if duration_ms == 0 and client_durations and i < len(client_durations):
                duration_ms = client_durations[i]
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

        # ── Transcript refinement (browser + Parakeet + Claude) ───────────
        await _log(workflow_id, "claude_decompose", "Refining voice transcripts...", 36)
        apparatus_catalog = await get_apparatus_catalog(workflow_id)
        refined_transcripts: list[str] = []

        for i, sd in enumerate(step_data):
            step_num = sd["step_number"]
            previous = refined_transcripts[:i]

            try:
                refined = await _refine_transcript(
                    browser_transcript=sd["transcript"],
                    video_path=sd["video_path"],
                    step_number=step_num,
                    workflow_title=wf_title,
                    workflow_description=wf_description,
                    apparatus_catalog=apparatus_catalog,
                    previous_transcripts=previous,
                    note=sd["note"],
                )
                original = step_transcripts[i] if i < len(step_transcripts) else ""
                sd["transcript"] = refined
                refined_transcripts.append(refined)
                if refined != original:
                    await _log(
                        workflow_id, "claude_decompose",
                        f"Step {step_num} transcript refined", 36 + int((step_num / total_steps) * 4),
                    )
            except Exception as e:
                print(f"[HardwarePipeline] Transcript refinement failed for step {step_num}: {e}", flush=True)
                refined_transcripts.append(sd["transcript"])

        # ── Claude step annotation ────────────────────────────────────────
        await _log(workflow_id, "claude_decompose", "Generating step titles and annotations...", 40)

        steps_created = 0
        workflow_offset_ms = 0
        for sd in step_data:
            step_num = sd["step_number"]
            pct = 40 + int((step_num / total_steps) * 15)

            title, description, ai_summary = await _generate_step_metadata(
                sd["transcript"], step_num, sd["note"],
                total_steps=total_steps,
                workflow_title=wf_title,
                workflow_description=wf_description,
            )

            step_id = new_id()
            ts = now_ms()
            key_frame_path = sd["key_frame"]["relative_path"] if sd["key_frame"] else None

            wf_start = workflow_offset_ms
            wf_end = workflow_offset_ms + sd["duration_ms"]

            await execute(
                """INSERT INTO steps
                   (id, workflow_id, step_number, title, description,
                    start_ms, end_ms, workflow_start_ms, workflow_end_ms,
                    key_frame_path, video_path,
                    ai_description, transcript, note,
                    created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    step_id, workflow_id, step_num, title, description,
                    wf_start, wf_end, wf_start, wf_end,
                    key_frame_path, sd["relative_video_path"],
                    ai_summary, sd["transcript"], sd["note"],
                    ts, ts,
                ),
            )
            workflow_offset_ms = wf_end
            steps_created += 1

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

            # ── Multi-agent key object analysis with memory context ───────
            if sd["frames"]:
                await _log(
                    workflow_id, "nemotron_vl",
                    f"Step {step_num}: Running multi-object detection...",
                    55 + int((step_num / total_steps) * 30),
                )

                try:
                    context = await build_step_context(workflow_id, step_num)

                    all_frame_paths = [frm["path"] for frm in sd["frames"]]
                    budget = _detection_frame_budget(sd["duration_ms"])
                    frame_paths = _subsample_frames(all_frame_paths, max_frames=budget)
                    analysis = await run_key_object_analysis_multi(
                        frame_paths=frame_paths,
                        step_title=title,
                        step_description=description,
                        transcript=sd["transcript"],
                        note=sd["note"],
                        context=context,
                    )

                    target_objects = analysis["target_objects"]
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

                    all_frame_detections = []
                    for label, detections in analysis["detection_results"].items():
                        for det in detections:
                            all_frame_detections.append(det)
                            fpath = det["frame_path"]
                            fid = frame_id_map.get(fpath)
                            if fid and det["present"]:
                                await execute(
                                    "UPDATE step_frames SET object_detected=?, object_description=? WHERE id=?",
                                    (1, det.get("description", ""), fid),
                                )

                    # Store SAM3 segmentation results as click_targets
                    import base64 as b64mod
                    from services.sam3_service import generate_segmented_image

                    masks_dir = UPLOADS_DIR / workflow_id / "masks" / step_id
                    masks_dir.mkdir(parents=True, exist_ok=True)

                    seg_by_frame: dict[str, list[dict]] = {}
                    for seg_result in analysis["segmentations"]:
                        seg_frame_abs = seg_result.get("frame_path", "")
                        seg_frame_rel = str(Path(seg_frame_abs).relative_to(UPLOADS_DIR.parent)) if seg_frame_abs else None

                        if seg_frame_abs:
                            seg_by_frame.setdefault(seg_frame_abs, []).extend(seg_result["segments"])

                        for seg in seg_result["segments"]:
                            bbox = seg.get("bbox", [0, 0, 0, 0])
                            ct_id = new_id()
                            seg_label = seg.get("label", primary_obj.get("label", title))
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

                    seg_dir = UPLOADS_DIR / workflow_id / "segmented" / step_id
                    for frame_abs, segs in seg_by_frame.items():
                        fid = frame_id_map.get(frame_abs)
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

                    # ── Context writeback to memory layer ─────────────────
                    await update_context_with_observations(
                        workflow_id=workflow_id,
                        step_number=step_num,
                        objects_identified=target_objects,
                        frame_observations=all_frame_detections,
                        new_observations=ai_summary or "",
                    )

                    total_pos = sum(analysis["positive_frame_counts"].values())
                    total_frames = analysis["total_frame_count"]
                    obj_names = ", ".join(f'"{o["label"]}"' for o in target_objects)
                    await _log(
                        workflow_id, "nemotron_vl",
                        f"Step {step_num}: {obj_names} — {total_pos} detections across {total_frames} frames",
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
                    "start_ms": wf_start,
                    "end_ms": wf_end,
                    "workflow_start_ms": wf_start,
                    "workflow_end_ms": wf_end,
                    "key_frame_path": key_frame_path,
                    "video_path": sd["relative_video_path"],
                },
            })

            await _log(
                workflow_id, "claude_decompose",
                f"Step {step_num} created: \"{title}\"",
                55 + int((step_num / total_steps) * 35),
            )

        # ── Finalize ──────────────────────────────────────────────────────
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

    # Step 1: get a server-side transcript from the video audio
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

    # If neither source produced anything, return whatever we have
    if not browser_text and not server_text:
        return browser_text
    # If only one source, and no API key for Claude, just return the best one
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return server_text or browser_text

    # Step 2: Claude reconciliation
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
            model="claude-haiku-4-20250514",
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
