import json
import shutil
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, HTTPException
from models.database import execute, new_id, now_ms

router = APIRouter(prefix="/api/workflows", tags=["recording"])

UPLOAD_DIR = Path(__file__).parent.parent / "uploads" / "videos"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload-steps")
async def upload_step_videos(
    background_tasks: BackgroundTasks,
    step_videos: list[UploadFile] = File(...),
    title: str = Form(...),
    initial_description: Optional[str] = Form(None),
    step_transcripts_json: Optional[str] = Form(None),
    step_notes_json: Optional[str] = Form(None),
):
    """
    Accept per-step video segments from hardware (webcam) guided recording.
    Each file in step_videos corresponds to one step, ordered by step number.
    """
    if not step_videos:
        raise HTTPException(400, "At least one step video is required")

    workflow_id = new_id()
    ts = now_ms()

    step_transcripts: list[str] = []
    if step_transcripts_json:
        try:
            step_transcripts = json.loads(step_transcripts_json)
        except Exception:
            pass

    step_notes: list[str] = []
    if step_notes_json:
        try:
            step_notes = json.loads(step_notes_json)
        except Exception:
            pass

    workflow_video_dir = UPLOAD_DIR / workflow_id
    workflow_video_dir.mkdir(parents=True, exist_ok=True)

    step_video_paths: list[str] = []
    for i, vid in enumerate(step_videos):
        ext = Path(vid.filename).suffix if vid.filename else ".webm"
        filename = f"step_{i + 1}{ext}"
        file_path = workflow_video_dir / filename
        with open(file_path, "wb") as f:
            shutil.copyfileobj(vid.file, f)
        step_video_paths.append(str(file_path))

    await execute(
        """INSERT INTO workflows (id, title, description, mode, status, video_path, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (workflow_id, title, initial_description, "hardware", "processing",
         f"uploads/videos/{workflow_id}", ts, ts),
    )

    from services.hardware_pipeline import run_hardware_pipeline
    background_tasks.add_task(
        run_hardware_pipeline,
        workflow_id=workflow_id,
        step_video_paths=step_video_paths,
        step_transcripts=step_transcripts,
        step_notes=step_notes,
    )

    return {"workflow_id": workflow_id, "status": "processing"}
