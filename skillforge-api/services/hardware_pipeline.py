"""
HARDWARE (webcam/guided) WORKFLOW PIPELINE — processes per-step video segments.

Each step arrives as its own video file. The pipeline:
  1. Extracts key frames from each step video
  2. Runs YOLO UI-element detection on key frames
  3. Uses Claude to generate titles, descriptions, and annotations per step
  4. Optionally uploads media to Cloudflare R2

Called as a FastAPI BackgroundTask from routers/recording.py (upload-steps endpoint).
"""
import os
import json
import asyncio
from pathlib import Path
from models.database import execute, new_id, now_ms
from websockets.pipeline_ws import broadcast
from services.video_processor import extract_frames, get_video_duration_ms
from services.yolo_detector import detect_ui_elements

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
):
    """
    Process per-step video segments for a hardware/webcam guided recording.
    Each video file corresponds to one step (ordered by step number).
    """
    total_steps = len(step_video_paths)
    try:
        await _log(workflow_id, "frame_extraction", f"Processing {total_steps} step videos...", 2)

        total_duration_ms = 0
        step_data: list[dict] = []

        for i, video_path in enumerate(step_video_paths):
            step_num = i + 1
            pct_base = int((i / total_steps) * 50) + 5
            transcript = step_transcripts[i] if i < len(step_transcripts) else ""

            await _log(
                workflow_id, "frame_extraction",
                f"Extracting frames from step {step_num}/{total_steps}...", pct_base,
            )

            frames = await extract_frames(video_path, workflow_id, on_progress=None)
            duration_ms = get_video_duration_ms(video_path)
            total_duration_ms += duration_ms

            # Pick key frame closest to the midpoint
            mid_ms = duration_ms // 2
            key_frame = min(frames, key=lambda f: abs(f["timestamp_ms"] - mid_ms)) if frames else None

            # Run YOLO on key frame
            yolo_detections: list[dict] = []
            if key_frame:
                yolo_detections = await detect_ui_elements(key_frame["path"])

            step_data.append({
                "step_number": step_num,
                "video_path": video_path,
                "relative_video_path": str(Path(video_path).relative_to(UPLOADS_DIR.parent)),
                "duration_ms": duration_ms,
                "frames": frames,
                "key_frame": key_frame,
                "yolo_detections": yolo_detections,
                "transcript": transcript,
            })

        await execute(
            "UPDATE workflows SET duration_ms=?, updated_at=? WHERE id=?",
            (total_duration_ms, now_ms(), workflow_id),
        )
        await _log(workflow_id, "frame_extraction", "Frame extraction complete", 55)

        # ── Claude step annotation ────────────────────────────────────────────
        await _log(workflow_id, "claude_decompose", "Generating step titles and annotations...", 60)

        steps_created = 0
        for sd in step_data:
            step_num = sd["step_number"]
            pct = 60 + int((step_num / total_steps) * 30)

            title, description = await _generate_step_metadata(
                sd["transcript"], step_num, sd["yolo_detections"],
            )

            step_id = new_id()
            ts = now_ms()
            key_frame_path = sd["key_frame"]["relative_path"] if sd["key_frame"] else None

            await execute(
                """INSERT INTO steps
                   (id, workflow_id, step_number, title, description,
                    start_ms, end_ms, key_frame_path, video_path, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    step_id, workflow_id, step_num, title, description,
                    0, sd["duration_ms"],
                    key_frame_path, sd["relative_video_path"],
                    ts, ts,
                ),
            )
            steps_created += 1

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
                f"Step {step_num} created: \"{title}\"", pct,
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


async def _generate_step_metadata(
    transcript: str,
    step_number: int,
    yolo_detections: list[dict],
) -> tuple[str, str]:
    """
    Use Claude to generate a concise title and imperative description
    from the expert's voice transcript for a single step.
    Falls back to generic text if the API call fails.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or not transcript.strip():
        return (
            f"Step {step_number}",
            transcript.strip() or f"Perform step {step_number}",
        )

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        yolo_summary = ""
        if yolo_detections:
            items = [
                f"{d.get('class', '?')} ({round(d.get('confidence', 0), 2)})"
                for d in yolo_detections[:8]
            ]
            yolo_summary = f"\nDetected UI elements: {', '.join(items)}"

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=(
                "You generate concise step metadata for a tutorial. "
                "Reply ONLY with valid JSON: {\"title\": \"...\", \"description\": \"...\"}\n"
                "Title: max 8 words, no step number prefix.\n"
                "Description: direct imperative instruction starting with a verb."
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"Step {step_number} transcript: \"{transcript}\""
                    f"{yolo_summary}\n\n"
                    "Generate the title and description JSON."
                ),
            }],
        )

        text = response.content[0].text.strip()
        data = json.loads(text)
        return (
            data.get("title", f"Step {step_number}"),
            data.get("description", transcript.strip()),
        )
    except Exception as e:
        print(f"[HardwarePipeline] Claude metadata generation failed: {e}")
        title = transcript.strip()[:60] or f"Step {step_number}"
        return (title, transcript.strip() or f"Perform step {step_number}")
