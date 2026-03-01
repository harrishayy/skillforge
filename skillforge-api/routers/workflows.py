from fastapi import APIRouter, HTTPException, Query
from models.database import fetchone, fetchall, execute, new_id, now_ms
from models.schemas import WorkflowUpdateRequest, WorkflowDetailResponse, WorkflowListResponse

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


def _bool_published(wf: dict) -> dict:
    """Convert the integer published column to a Python bool."""
    wf["published"] = bool(wf.get("published", 0))
    return wf


async def _get_full_workflow(workflow_id: str) -> dict:
    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, f"Workflow {workflow_id} not found")

    steps_raw = await fetchall(
        "SELECT * FROM steps WHERE workflow_id=? ORDER BY step_number", (workflow_id,)
    )
    steps = []
    for step in steps_raw:
        annotations = await fetchall(
            "SELECT * FROM annotations WHERE step_id=? ORDER BY created_at", (step["id"],)
        )
        click_targets = await fetchall(
            "SELECT * FROM click_targets WHERE step_id=?", (step["id"],)
        )
        for ct in click_targets:
            ct["is_primary"] = bool(ct["is_primary"])
        frames_raw = await fetchall(
            "SELECT * FROM step_frames WHERE step_id=? ORDER BY timestamp_ms", (step["id"],)
        )
        frames = [
            {
                **f,
                "is_key_frame": bool(f.get("is_key_frame", 0)),
                "object_detected": bool(f.get("object_detected", 0)),
            }
            for f in frames_raw
        ]
        steps.append({**step, "annotations": annotations, "click_targets": click_targets, "frames": frames})

    apparatus_objects = await fetchall(
        "SELECT * FROM workflow_objects WHERE workflow_id=? ORDER BY created_at",
        (workflow_id,),
    )
    for obj in apparatus_objects:
        import json as _json
        raw = obj.get("reference_frame_paths")
        if isinstance(raw, str):
            try:
                obj["reference_frame_paths"] = _json.loads(raw)
            except Exception:
                obj["reference_frame_paths"] = []
        elif raw is None:
            obj["reference_frame_paths"] = []

        raw_seg = obj.get("segmented_frame_paths")
        if isinstance(raw_seg, str):
            try:
                obj["segmented_frame_paths"] = _json.loads(raw_seg)
            except Exception:
                obj["segmented_frame_paths"] = {}
        elif raw_seg is None:
            obj["segmented_frame_paths"] = {}

    thumbnail = steps[0]["key_frame_path"] if steps else None
    return _bool_published({
        **wf,
        "steps": steps,
        "apparatus_objects": apparatus_objects,
        "thumbnail_path": thumbnail,
    })


@router.get("")
async def list_workflows(published_only: bool = Query(False)):
    if published_only:
        rows = await fetchall(
            "SELECT * FROM workflows WHERE published=1 AND status='ready' ORDER BY created_at DESC"
        )
    else:
        rows = await fetchall("SELECT * FROM workflows ORDER BY created_at DESC")

    summaries = []
    for wf in rows:
        first_step = await fetchone(
            "SELECT key_frame_path FROM steps WHERE workflow_id=? ORDER BY step_number LIMIT 1",
            (wf["id"],),
        )
        summaries.append(_bool_published({
            **wf,
            "thumbnail_path": first_step["key_frame_path"] if first_step else None,
        }))
    return {"workflows": summaries}


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str):
    return await _get_full_workflow(workflow_id)


@router.patch("/{workflow_id}")
async def update_workflow(workflow_id: str, body: WorkflowUpdateRequest):
    wf = await fetchone("SELECT id FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    updates = {}
    if body.title is not None:
        updates["title"] = body.title
    if body.description is not None:
        updates["description"] = body.description
    if body.published is not None:
        updates["published"] = int(body.published)

    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        await execute(
            f"UPDATE workflows SET {set_clause}, updated_at=? WHERE id=?",
            (*updates.values(), now_ms(), workflow_id),
        )

    return await _get_full_workflow(workflow_id)


@router.post("/{workflow_id}/publish")
async def publish_workflow(workflow_id: str):
    wf = await fetchone("SELECT id, status FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if wf["status"] != "ready":
        raise HTTPException(400, "Only ready workflows can be published")
    await execute(
        "UPDATE workflows SET published=1, updated_at=? WHERE id=?",
        (now_ms(), workflow_id),
    )
    return await _get_full_workflow(workflow_id)


@router.post("/{workflow_id}/unpublish")
async def unpublish_workflow(workflow_id: str):
    wf = await fetchone("SELECT id FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    await execute(
        "UPDATE workflows SET published=0, updated_at=? WHERE id=?",
        (now_ms(), workflow_id),
    )
    return await _get_full_workflow(workflow_id)


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str):
    wf = await fetchone("SELECT id FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    await execute("DELETE FROM workflows WHERE id=?", (workflow_id,))
    return {"success": True}
