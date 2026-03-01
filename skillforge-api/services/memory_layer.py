"""
Persistent memory layer for the multi-agent pipeline.

Each step gets a context document (JSON) that accumulates knowledge about
objects across frames and steps.  The context chain for step N includes:
  - Workflow metadata
  - Apparatus catalog (all objects from the showcase phase)
  - Summaries of steps 1..N-1 (titles, objects used, observations)
  - Current step data (transcript, title, description, note)

When a step is re-recorded, downstream contexts are invalidated and rebuilt.
"""
import json
from models.database import execute, fetchone, fetchall, new_id, now_ms


# ── Read helpers ──────────────────────────────────────────────────────────────

async def get_apparatus_catalog(workflow_id: str) -> list[dict]:
    """Fetch all cataloged objects for a workflow."""
    rows = await fetchall(
        "SELECT * FROM workflow_objects WHERE workflow_id=? ORDER BY created_at",
        (workflow_id,),
    )
    catalog = []
    for row in rows:
        ref_paths = []
        if row.get("reference_frame_paths"):
            try:
                ref_paths = json.loads(row["reference_frame_paths"])
            except (json.JSONDecodeError, TypeError):
                pass
        seg_paths = {}
        if row.get("segmented_frame_paths"):
            try:
                seg_paths = json.loads(row["segmented_frame_paths"])
            except (json.JSONDecodeError, TypeError):
                pass
        catalog.append({
            "id": row["id"],
            "object_name": row["object_name"],
            "object_type": row.get("object_type", "other"),
            "visual_cues": row.get("visual_cues", ""),
            "description": row.get("description", ""),
            "sam3_prompt": row.get("sam3_prompt", row["object_name"]),
            "angle_count": row.get("angle_count", 0),
            "reference_frames": ref_paths,
            "segmented_reference_path": row.get("segmented_reference_path", ""),
            "segmented_frame_paths": seg_paths,
        })
    return catalog


async def get_step_context(workflow_id: str, step_number: int) -> dict | None:
    """Fetch the stored context document for a specific step."""
    row = await fetchone(
        "SELECT * FROM step_contexts WHERE workflow_id=? AND step_number=?",
        (workflow_id, step_number),
    )
    if not row:
        return None
    try:
        return json.loads(row["context_json"])
    except (json.JSONDecodeError, TypeError):
        return None


# ── Build context chain ──────────────────────────────────────────────────────

async def build_step_context(
    workflow_id: str,
    step_number: int,
) -> dict:
    """
    Assemble the full context chain for a step from the DB:
      - Workflow metadata
      - Apparatus catalog
      - Previous step contexts (1..step_number-1)
      - Current step data
    """
    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))
    workflow_meta = {
        "title": wf["title"] if wf else "",
        "description": wf.get("description", "") if wf else "",
    }

    catalog = await get_apparatus_catalog(workflow_id)

    previous_steps = []
    if step_number > 1:
        for sn in range(1, step_number):
            ctx = await get_step_context(workflow_id, sn)
            if ctx and "step_summary" in ctx:
                previous_steps.append(ctx["step_summary"])
            else:
                step_row = await fetchone(
                    "SELECT * FROM steps WHERE workflow_id=? AND step_number=?",
                    (workflow_id, sn),
                )
                if step_row:
                    previous_steps.append({
                        "step_number": sn,
                        "title": step_row.get("title", ""),
                        "description": step_row.get("description", ""),
                        "transcript": step_row.get("transcript", ""),
                        "objects_used": [],
                        "observations": "",
                        "frame_insights": [],
                    })

    current_step_row = await fetchone(
        "SELECT * FROM steps WHERE workflow_id=? AND step_number=?",
        (workflow_id, step_number),
    )
    current_step = {}
    if current_step_row:
        current_step = {
            "step_number": step_number,
            "title": current_step_row.get("title", ""),
            "description": current_step_row.get("description", ""),
            "transcript": current_step_row.get("transcript", ""),
            "note": current_step_row.get("note", ""),
        }

    return {
        "workflow": workflow_meta,
        "apparatus_catalog": catalog,
        "previous_steps": previous_steps,
        "current_step": current_step,
    }


# ── Save / update ────────────────────────────────────────────────────────────

async def save_step_context(
    workflow_id: str,
    step_number: int,
    context: dict,
) -> None:
    """Write or update the context document for a step."""
    ts = now_ms()
    context_str = json.dumps(context, ensure_ascii=False)

    existing = await fetchone(
        "SELECT id, version FROM step_contexts WHERE workflow_id=? AND step_number=?",
        (workflow_id, step_number),
    )
    if existing:
        new_version = (existing.get("version", 1) or 1) + 1
        await execute(
            "UPDATE step_contexts SET context_json=?, version=?, updated_at=? WHERE id=?",
            (context_str, new_version, ts, existing["id"]),
        )
    else:
        await execute(
            """INSERT INTO step_contexts
               (id, workflow_id, step_number, context_json, version, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?)""",
            (new_id(), workflow_id, step_number, context_str, 1, ts, ts),
        )


async def update_context_with_observations(
    workflow_id: str,
    step_number: int,
    objects_identified: list[dict],
    frame_observations: list[dict],
    new_observations: str = "",
) -> None:
    """
    Enrich a step's context with what the agents found during analysis.
    Called after Claude/Nemotron/SAM3 finish processing a step.
    """
    ctx = await get_step_context(workflow_id, step_number)
    if not ctx:
        ctx = await build_step_context(workflow_id, step_number)

    objects_used = [obj.get("label", obj.get("key_object", "")) for obj in objects_identified]

    insights = []
    for obs in frame_observations:
        if obs.get("present") and obs.get("description"):
            insights.append(obs["description"][:200])

    step_row = await fetchone(
        "SELECT * FROM steps WHERE workflow_id=? AND step_number=?",
        (workflow_id, step_number),
    )

    ctx["step_summary"] = {
        "step_number": step_number,
        "title": step_row.get("title", "") if step_row else "",
        "description": step_row.get("description", "") if step_row else "",
        "transcript": step_row.get("transcript", "") if step_row else "",
        "objects_used": objects_used,
        "observations": new_observations,
        "frame_insights": insights[:10],
    }

    await save_step_context(workflow_id, step_number, ctx)


# ── Invalidation ─────────────────────────────────────────────────────────────

async def invalidate_contexts_from(
    workflow_id: str,
    from_step: int,
) -> list[int]:
    """
    Delete context documents for from_step and all subsequent steps.
    Returns the list of step numbers that were invalidated.
    """
    rows = await fetchall(
        "SELECT step_number FROM step_contexts WHERE workflow_id=? AND step_number>=? ORDER BY step_number",
        (workflow_id, from_step),
    )
    invalidated = [r["step_number"] for r in rows]
    if invalidated:
        await execute(
            "DELETE FROM step_contexts WHERE workflow_id=? AND step_number>=?",
            (workflow_id, from_step),
        )
        print(
            f"[MemoryLayer] Invalidated contexts for steps {invalidated} in workflow {workflow_id}",
            flush=True,
        )
    return invalidated


# ── Apparatus catalog management ─────────────────────────────────────────────

async def save_apparatus_object(
    workflow_id: str,
    object_name: str,
    object_type: str = "other",
    visual_cues: str = "",
    sam3_prompt: str = "",
    angle_count: int = 0,
    reference_frame_paths: list[str] | None = None,
    description: str = "",
    segmented_reference_path: str = "",
    segmented_frame_paths: dict[str, str] | None = None,
) -> str:
    """Insert a single apparatus object into the catalog. Returns its id."""
    obj_id = new_id()
    ts = now_ms()
    ref_json = json.dumps(reference_frame_paths or [])
    seg_json = json.dumps(segmented_frame_paths or {})
    await execute(
        """INSERT INTO workflow_objects
           (id, workflow_id, object_name, object_type, visual_cues, sam3_prompt,
            angle_count, reference_frame_paths, description, segmented_reference_path,
            segmented_frame_paths, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (obj_id, workflow_id, object_name, object_type, visual_cues,
         sam3_prompt or object_name, angle_count, ref_json,
         description, segmented_reference_path, seg_json, ts),
    )
    return obj_id


async def clear_apparatus_catalog(workflow_id: str) -> None:
    """Remove all apparatus objects for a workflow (used before re-analysis)."""
    await execute(
        "DELETE FROM workflow_objects WHERE workflow_id=?",
        (workflow_id,),
    )
