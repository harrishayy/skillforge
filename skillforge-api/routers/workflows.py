from fastapi import APIRouter, HTTPException
from models.database import fetchone, fetchall, execute, new_id, now_ms
from models.schemas import WorkflowUpdateRequest, WorkflowDetailResponse, WorkflowListResponse

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


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
        # Convert is_primary int to bool
        for ct in click_targets:
            ct["is_primary"] = bool(ct["is_primary"])
        steps.append({**step, "annotations": annotations, "click_targets": click_targets})

    # thumbnail = first keyframe
    thumbnail = steps[0]["key_frame_path"] if steps else None
    return {**wf, "steps": steps, "thumbnail_path": thumbnail}


@router.get("")
async def list_workflows():
    rows = await fetchall("SELECT * FROM workflows ORDER BY created_at DESC")
    summaries = []
    for wf in rows:
        first_step = await fetchone(
            "SELECT key_frame_path FROM steps WHERE workflow_id=? ORDER BY step_number LIMIT 1",
            (wf["id"],),
        )
        summaries.append({
            **wf,
            "thumbnail_path": first_step["key_frame_path"] if first_step else None,
        })
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

    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        await execute(
            f"UPDATE workflows SET {set_clause}, updated_at=? WHERE id=?",
            (*updates.values(), now_ms(), workflow_id),
        )

    return await _get_full_workflow(workflow_id)


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str):
    wf = await fetchone("SELECT id FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    await execute("DELETE FROM workflows WHERE id=?", (workflow_id,))
    return {"success": True}
