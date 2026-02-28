"""
SOFTWARE WORKFLOW PIPELINE — do not use for physical apprenticeship workflows.
Main pipeline orchestrator. Called as a FastAPI BackgroundTask.
Coordinates: frame extraction → Nemotron VL (software prompt) → YOLO → Claude decomposition.

Physical workflows use: services/physical_pipeline.py
"""
import os
import json
import asyncio
import time
from pathlib import Path
from models.database import execute, fetchall, new_id, now_ms
from websockets.pipeline_ws import broadcast
from services.video_processor import extract_frames, get_video_duration_ms
from services.nemotron_client import analyze_frames_batch
from services.yolo_detector import detect_ui_elements
from services.claude_orchestrator import decompose_workflow
from services import storage_service
from utils.event_mapper import get_events_near_timestamp

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
    print(f"[Pipeline:{workflow_id}] [{stage}] {message} ({progress}%)")


async def run_pipeline(
    workflow_id: str,
    video_path: str,
    input_events_json: str | None = None,
    step_markers_json: str | None = None,
    step_transcripts_json: str | None = None,
):
    """Full SOFTWARE pipeline: frame extraction → Nemotron VL → YOLO → Claude decomposition.
    When step_markers_json is provided (guided recording), step boundaries are pre-defined
    and Nemotron VL analysis is skipped in favour of using expert transcripts for step naming.
    """
    mode = "software"
    nim_api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")

    input_events: list[dict] = []
    if input_events_json:
        try:
            input_events = json.loads(input_events_json)
        except Exception:
            pass

    step_markers: list[dict] = []
    if step_markers_json:
        try:
            step_markers = json.loads(step_markers_json)
        except Exception:
            pass

    step_transcripts: list[str] = []
    if step_transcripts_json:
        try:
            step_transcripts = json.loads(step_transcripts_json)
        except Exception:
            pass

    guided_mode = bool(step_markers)

    try:
        # ── Stage 1: Frame Extraction ─────────────────────────────────────────
        await _log(workflow_id, "frame_extraction", "Extracting key frames from video...", 5)

        async def on_frame_progress(msg: str, pct: int):
            await _log(workflow_id, "frame_extraction", msg, pct)

        frames = await extract_frames(video_path, workflow_id, on_progress=on_frame_progress)
        duration_ms = get_video_duration_ms(video_path)

        await execute(
            "UPDATE workflows SET duration_ms=?, updated_at=? WHERE id=?",
            (duration_ms, now_ms(), workflow_id),
        )
        await _log(workflow_id, "frame_extraction", f"Extracted {len(frames)} key frames", 10)

        if guided_mode:
            # ── Guided mode: step boundaries pre-defined, skip Nemotron VL ────
            await _log(workflow_id, "nemotron_vl", "Guided recording — skipping VL boundary detection", 50)
            # Attach minimal metadata to frames so orchestrator has visual data
            frame_analyses = [
                {**f, "yolo_detections": [], "input_events": []}
                for f in frames
            ]
        else:
            # ── Stage 2: Nemotron VL Analysis ─────────────────────────────────
            await _log(workflow_id, "nemotron_vl", "Running Nemotron VL frame analysis...", 15)

            async def on_vl_progress(msg: str, pct: int):
                await _log(workflow_id, "nemotron_vl", msg, pct)

            frame_analyses = await analyze_frames_batch(
                frames,
                api_key=nim_api_key,
                on_progress=on_vl_progress,
            )

            await _log(workflow_id, "nemotron_vl", "Nemotron VL analysis complete", 50)

        # ── Stage 3: YOLO UI Element Detection ───────────────────────────────
        await _log(workflow_id, "yolo", "Detecting UI elements with YOLO...", 52)
        for fa in frame_analyses:
            if not fa.get("yolo_detections"):
                detections = await detect_ui_elements(fa["path"])
                fa["yolo_detections"] = detections
        await _log(workflow_id, "yolo", "UI element detection complete", 60)

        # Attach input events to nearest frames
        for fa in frame_analyses:
            fa["input_events"] = get_events_near_timestamp(
                input_events, fa["timestamp_ms"], window_ms=800
            )

        # ── Stage 4: Claude Decomposition ─────────────────────────────────────
        await _log(workflow_id, "claude_decompose", "Claude is decomposing the workflow...", 65)

        async def on_claude_progress(msg: str, pct: int):
            await _log(workflow_id, "claude_decompose", msg, pct)

        steps_created = await decompose_workflow(
            workflow_id=workflow_id,
            frame_analyses=frame_analyses,
            on_progress=on_claude_progress,
            step_markers=step_markers if guided_mode else None,
            step_transcripts=step_transcripts if guided_mode else None,
        )

        # ── Finalize ─────────────────────────────────────────────────────────
        await execute(
            "UPDATE workflows SET status='ready', total_steps=?, updated_at=? WHERE id=?",
            (steps_created, now_ms(), workflow_id),
        )

        # ── Stage 5: Upload media to Cloudflare R2 (if configured) ───────────
        if storage_service.is_configured():
            await _log(workflow_id, "storage", "Uploading media to Cloudflare R2...", 92)
            try:
                # Upload video
                video_key = storage_service.make_video_key(workflow_id, Path(video_path).name)
                r2_video_url = await storage_service.upload_file(video_path, video_key)
                await execute(
                    "UPDATE workflows SET video_path=? WHERE id=?",
                    (r2_video_url, workflow_id),
                )

                # Upload each frame and update step key_frame_path
                steps_db = await fetchall(
                    "SELECT id, key_frame_path FROM steps WHERE workflow_id=?",
                    (workflow_id,),
                )
                for step in steps_db:
                    local_rel = step.get("key_frame_path")
                    if not local_rel:
                        continue
                    abs_path = UPLOADS_DIR.parent / local_rel
                    frame_key = storage_service.make_frame_key(workflow_id, Path(local_rel).name)
                    r2_url = await storage_service.upload_file(str(abs_path), frame_key)
                    await execute(
                        "UPDATE steps SET key_frame_path=? WHERE id=?",
                        (r2_url, step["id"]),
                    )
                await _log(workflow_id, "storage", "Media uploaded to R2 CDN", 97)
            except Exception as e:
                print(f"[Pipeline] R2 upload failed (non-fatal): {e}")

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
        print(f"[Pipeline ERROR] {e}\n{tb}")
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
