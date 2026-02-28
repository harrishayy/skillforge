import os
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, HTTPException
from models.database import execute, new_id, now_ms
from services.workflow_builder import run_pipeline

router = APIRouter(prefix="/api/workflows", tags=["recording"])

UPLOAD_DIR = Path(__file__).parent.parent / "uploads" / "videos"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload")
async def upload_recording(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    mode: str = Form(...),
    title: str = Form(...),
    input_events: str | None = Form(None),
    step_markers_json: str | None = Form(None),
    step_transcripts_json: str | None = Form(None),
    initial_description: str | None = Form(None),
):
    if mode != "software":
        raise HTTPException(400, "This endpoint is for software screen-recording workflows only. Use /api/physical/record for physical apprenticeship recordings.")

    workflow_id = new_id()
    ts = now_ms()

    # Save video to disk
    ext = Path(video.filename).suffix if video.filename else ".webm"
    video_filename = f"{workflow_id}{ext}"
    video_path = UPLOAD_DIR / video_filename
    with open(video_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    relative_video_path = f"uploads/videos/{video_filename}"

    # Create workflow record
    await execute(
        """INSERT INTO workflows (id, title, description, mode, status, video_path, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (workflow_id, title, initial_description, mode, "processing", relative_video_path, ts, ts),
    )

    # Fire background pipeline
    background_tasks.add_task(
        run_pipeline,
        workflow_id=workflow_id,
        video_path=str(video_path),
        input_events_json=input_events,
        step_markers_json=step_markers_json,
        step_transcripts_json=step_transcripts_json,
    )

    return {"workflow_id": workflow_id, "status": "processing"}
