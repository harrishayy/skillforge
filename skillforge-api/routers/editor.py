from fastapi import APIRouter, HTTPException
from models.database import fetchone, fetchall, execute, new_id, now_ms
from models.schemas import (
    StepCreateRequest,
    StepUpdateRequest,
    AnnotationCreateRequest,
    ClickTargetCreateRequest,
    AnalyzeFrameRequest,
)

router = APIRouter(tags=["editor"])


# ─── Steps ────────────────────────────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/steps")
async def create_step(workflow_id: str, body: StepCreateRequest):
    wf = await fetchone("SELECT id FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    step_id = new_id()
    ts = now_ms()
    await execute(
        """INSERT INTO steps
           (id, workflow_id, step_number, title, description, start_ms, end_ms, key_frame_path, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (step_id, workflow_id, body.step_number, body.title, body.description,
         body.start_ms, body.end_ms, body.key_frame_path, ts, ts),
    )
    return await _get_step(step_id)


@router.patch("/api/steps/{step_id}")
async def update_step(step_id: str, body: StepUpdateRequest):
    step = await fetchone("SELECT id FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        await execute(
            f"UPDATE steps SET {set_clause}, updated_at=? WHERE id=?",
            (*updates.values(), now_ms(), step_id),
        )
    return await _get_step(step_id)


@router.delete("/api/steps/{step_id}")
async def delete_step(step_id: str):
    step = await fetchone("SELECT id FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")
    await execute("DELETE FROM steps WHERE id=?", (step_id,))
    return {"success": True}


# ─── Annotations ──────────────────────────────────────────────────────────────

@router.post("/api/steps/{step_id}/annotations")
async def create_annotation(step_id: str, body: AnnotationCreateRequest):
    step = await fetchone("SELECT id FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    ann_id = new_id()
    await execute(
        """INSERT INTO annotations
           (id, step_id, type, label, x, y, width, height, from_x, from_y, to_x, to_y, color, style, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ann_id, step_id, body.type, body.label, body.x, body.y, body.width, body.height,
         body.from_x, body.from_y, body.to_x, body.to_y, body.color, body.style, now_ms()),
    )
    return await fetchone("SELECT * FROM annotations WHERE id=?", (ann_id,))


@router.put("/api/annotations/{annotation_id}")
async def update_annotation(annotation_id: str, body: AnnotationCreateRequest):
    ann = await fetchone("SELECT id FROM annotations WHERE id=?", (annotation_id,))
    if not ann:
        raise HTTPException(404, "Annotation not found")

    await execute(
        """UPDATE annotations SET type=?, label=?, x=?, y=?, width=?, height=?,
           from_x=?, from_y=?, to_x=?, to_y=?, color=?, style=? WHERE id=?""",
        (body.type, body.label, body.x, body.y, body.width, body.height,
         body.from_x, body.from_y, body.to_x, body.to_y, body.color, body.style, annotation_id),
    )
    return await fetchone("SELECT * FROM annotations WHERE id=?", (annotation_id,))


@router.delete("/api/annotations/{annotation_id}")
async def delete_annotation(annotation_id: str):
    ann = await fetchone("SELECT id FROM annotations WHERE id=?", (annotation_id,))
    if not ann:
        raise HTTPException(404, "Annotation not found")
    await execute("DELETE FROM annotations WHERE id=?", (annotation_id,))
    return {"success": True}


# ─── Click Targets ────────────────────────────────────────────────────────────

@router.post("/api/steps/{step_id}/click-targets")
async def create_click_target(step_id: str, body: ClickTargetCreateRequest):
    step = await fetchone("SELECT id FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    ct_id = new_id()
    await execute(
        """INSERT INTO click_targets
           (id, step_id, element_text, element_type, bbox_x, bbox_y, bbox_width, bbox_height, action, is_primary)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (ct_id, step_id, body.element_text, body.element_type,
         body.bbox_x, body.bbox_y, body.bbox_width, body.bbox_height,
         body.action, 1 if body.is_primary else 0),
    )
    row = await fetchone("SELECT * FROM click_targets WHERE id=?", (ct_id,))
    row["is_primary"] = bool(row["is_primary"])
    return row


@router.delete("/api/click-targets/{target_id}")
async def delete_click_target(target_id: str):
    ct = await fetchone("SELECT id FROM click_targets WHERE id=?", (target_id,))
    if not ct:
        raise HTTPException(404, "Click target not found")
    await execute("DELETE FROM click_targets WHERE id=?", (target_id,))
    return {"success": True}


# ─── On-demand frame analysis ─────────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/analyze-frame")
async def analyze_frame_on_demand(workflow_id: str, body: AnalyzeFrameRequest):
    import os
    from pathlib import Path
    from services.nemotron_client import analyze_frame
    from services.yolo_detector import detect_ui_elements
    from services.video_processor import extract_frames

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    video_path = Path(__file__).parent.parent / wf["video_path"]
    if not video_path.exists():
        raise HTTPException(404, "Video file not found")

    # Extract just this one frame
    frames = await extract_frames(str(video_path), workflow_id)
    target = min(frames, key=lambda f: abs(f["timestamp_ms"] - body.timestamp_ms))

    nim_key = os.environ.get("NVIDIA_NIM_API_KEY", "")
    vl_result = await analyze_frame(target["path"], wf["mode"], nim_key)
    yolo = await detect_ui_elements(target["path"]) if wf["mode"] == "software" else []

    return {
        "frame_path": target["relative_path"],
        "nemotron_analysis": vl_result,
        "yolo_detections": yolo,
    }


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_step(step_id: str) -> dict:
    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    annotations = await fetchall("SELECT * FROM annotations WHERE step_id=? ORDER BY created_at", (step_id,))
    click_targets = await fetchall("SELECT * FROM click_targets WHERE step_id=?", (step_id,))
    for ct in click_targets:
        ct["is_primary"] = bool(ct["is_primary"])
    return {**step, "annotations": annotations, "click_targets": click_targets}
