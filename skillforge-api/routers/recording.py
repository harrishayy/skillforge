import json
import shutil
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, HTTPException
from models.database import execute, new_id, now_ms

router = APIRouter(prefix="/api/workflows", tags=["recording"])

UPLOAD_DIR = Path(__file__).parent.parent / "uploads" / "videos"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# INCREMENTAL ENDPOINTS — steps processed as they arrive during recording
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/create")
async def create_workflow(
    title: str = Form(...),
    initial_description: Optional[str] = Form(None),
):
    """
    Create a workflow row up front so the frontend has a workflow_id
    to use when uploading apparatus and individual steps.
    """
    workflow_id = new_id()
    ts = now_ms()

    workflow_video_dir = UPLOAD_DIR / workflow_id
    workflow_video_dir.mkdir(parents=True, exist_ok=True)

    await execute(
        """INSERT INTO workflows (id, title, description, mode, status, video_path, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (workflow_id, title, initial_description, "hardware", "processing",
         f"uploads/videos/{workflow_id}", ts, ts),
    )

    print(f"[Recording] Workflow created: {workflow_id} — \"{title}\"", flush=True)
    return {"workflow_id": workflow_id, "status": "processing"}


@router.post("/{workflow_id}/apparatus")
async def upload_apparatus(
    workflow_id: str,
    apparatus_video: UploadFile = File(...),
):
    """
    Upload the apparatus showcase video and start processing it immediately.
    Must be called before any steps are uploaded so the object catalog is
    available when step 1 is processed.
    """
    workflow_video_dir = UPLOAD_DIR / workflow_id
    workflow_video_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(apparatus_video.filename).suffix if apparatus_video.filename else ".webm"
    apparatus_file = workflow_video_dir / f"apparatus{ext}"
    with open(apparatus_file, "wb") as f:
        shutil.copyfileobj(apparatus_video.file, f)
    apparatus_video_path = str(apparatus_file)
    print(f"[Recording] Apparatus video saved: {apparatus_video_path}", flush=True)

    from services.hardware_pipeline import WorkflowPipelineManager
    mgr = WorkflowPipelineManager.get_or_create(workflow_id)
    await mgr.enqueue_apparatus(apparatus_video_path)

    return {"status": "processing"}


@router.post("/{workflow_id}/step")
async def upload_single_step(
    workflow_id: str,
    step_video: UploadFile = File(...),
    step_number: int = Form(...),
    transcript: Optional[str] = Form(""),
    note: Optional[str] = Form(""),
    duration_ms: Optional[int] = Form(None),
):
    """
    Upload a single step video + metadata. Called each time the user
    finishes a step during recording. The step is queued for processing
    immediately, respecting ordering constraints.
    """
    workflow_video_dir = UPLOAD_DIR / workflow_id
    workflow_video_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(step_video.filename).suffix if step_video.filename else ".webm"
    filename = f"step_{step_number}{ext}"
    file_path = workflow_video_dir / filename
    with open(file_path, "wb") as f:
        shutil.copyfileobj(step_video.file, f)
    video_path = str(file_path)
    print(f"[Recording] Step {step_number} video saved: {video_path} ({(file_path.stat().st_size / 1024):.0f} KB)", flush=True)

    from services.hardware_pipeline import WorkflowPipelineManager
    mgr = WorkflowPipelineManager.get_or_create(workflow_id)
    await mgr.enqueue_step(
        step_number=step_number,
        video_path=video_path,
        transcript=transcript or "",
        note=note or "",
        client_duration=duration_ms,
    )

    return {"status": "queued", "step_number": step_number}


@router.post("/{workflow_id}/finalize")
async def finalize_workflow(
    workflow_id: str,
    total_steps: int = Form(...),
):
    """
    Signal that recording is complete. The pipeline manager will wait for
    all queued steps to finish, then emit the "complete" event.
    """
    from services.hardware_pipeline import WorkflowPipelineManager
    mgr = WorkflowPipelineManager.get_or_create(workflow_id)
    await mgr.finalize(total_steps)

    print(f"[Recording] Workflow {workflow_id} finalized with {total_steps} steps", flush=True)
    return {"status": "finalizing", "total_steps": total_steps}


# ═══════════════════════════════════════════════════════════════════════════════
# BATCH ENDPOINT — legacy fallback for crash recovery / retry
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/upload-steps")
async def upload_step_videos(
    background_tasks: BackgroundTasks,
    step_videos: list[UploadFile] = File(...),
    title: str = Form(...),
    initial_description: Optional[str] = Form(None),
    step_transcripts_json: Optional[str] = Form(None),
    step_notes_json: Optional[str] = Form(None),
    step_durations_json: Optional[str] = Form(None),
    apparatus_video: Optional[UploadFile] = File(None),
):
    """
    Accept per-step video segments from hardware (webcam) guided recording.
    Each file in step_videos corresponds to one step, ordered by step number.
    An optional apparatus_video can be included from the showcase phase.

    This is the legacy batch endpoint, kept for crash recovery and retry flows.
    """
    if not step_videos:
        raise HTTPException(400, "At least one step video is required")

    workflow_id = new_id()
    ts = now_ms()

    step_transcripts: list[str] = []
    if step_transcripts_json:
        try:
            step_transcripts = json.loads(step_transcripts_json)
        except Exception as e:
            print(f"[Recording] Failed to parse step_transcripts_json: {e} — transcripts will be empty", flush=True)

    step_notes: list[str] = []
    if step_notes_json:
        try:
            step_notes = json.loads(step_notes_json)
        except Exception as e:
            print(f"[Recording] Failed to parse step_notes_json: {e} — notes will be empty", flush=True)

    step_durations: list[int] = []
    if step_durations_json:
        try:
            step_durations = [int(d) for d in json.loads(step_durations_json)]
        except Exception as e:
            print(f"[Recording] Failed to parse step_durations_json: {e} — durations will be empty", flush=True)

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

    apparatus_video_path: str | None = None
    if apparatus_video and apparatus_video.filename:
        ext = Path(apparatus_video.filename).suffix or ".webm"
        apparatus_file = workflow_video_dir / f"apparatus{ext}"
        with open(apparatus_file, "wb") as f:
            shutil.copyfileobj(apparatus_video.file, f)
        apparatus_video_path = str(apparatus_file)
        print(f"[Recording] Apparatus video saved: {apparatus_video_path}", flush=True)

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
        client_durations=step_durations or None,
        apparatus_video_path=apparatus_video_path,
    )

    return {"workflow_id": workflow_id, "status": "processing"}
