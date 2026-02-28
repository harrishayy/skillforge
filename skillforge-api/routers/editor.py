from fastapi import APIRouter, HTTPException, UploadFile, File
from models.database import fetchone, fetchall, execute, execute_many, new_id, now_ms
from models.schemas import (
    StepCreateRequest,
    StepUpdateRequest,
    AnnotationCreateRequest,
    ClickTargetCreateRequest,
    AnalyzeFrameRequest,
    RegenerateStepRequest,
    SegmentPointRequest,
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


# ─── Review: Regenerate step ──────────────────────────────────────────────────

@router.post("/api/steps/{step_id}/regenerate")
async def regenerate_step(step_id: str, body: RegenerateStepRequest):
    """Re-run Claude on a single step with optional additional context."""
    import os, json, anthropic
    from pathlib import Path
    from services.video_processor import extract_frames
    from services.yolo_detector import detect_ui_elements

    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (step["workflow_id"],))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    # Delete existing annotations and click targets for this step
    await execute("DELETE FROM annotations WHERE step_id=?", (step_id,))
    await execute("DELETE FROM click_targets WHERE step_id=?", (step_id,))

    # Get YOLO detections for the key frame
    yolo_info = []
    kf_path = step.get("key_frame_path", "")
    if kf_path:
        abs_kf = kf_path if kf_path.startswith("http") else str(Path(__file__).parent.parent / kf_path)
        try:
            detections = await detect_ui_elements(abs_kf)
            yolo_info = [
                {"class": d.get("class"), "bbox": [d.get("bbox_x"), d.get("bbox_y"), d.get("bbox_width"), d.get("bbox_height")], "conf": round(d.get("confidence", 0), 2)}
                for d in detections[:10]
            ]
        except Exception:
            pass

    context_line = f'Additional context from expert: "{body.additional_context}"' if body.additional_context else ""
    user_msg = (
        f"Regenerate step {step['step_number']} of workflow \"{wf['title']}\".\n"
        f"Workflow description: {wf.get('description', 'N/A')}\n"
        f"Current title: \"{step['title']}\"\n"
        f"Current description: \"{step.get('description', '')}\"\n"
        f"Time range: {step['start_ms']}ms – {step['end_ms']}ms\n"
        f"YOLO detections on key frame: {json.dumps(yolo_info)}\n"
        f"{context_line}\n\n"
        "Create an improved version of this step by calling create_workflow_step. "
        "Use a concise title (max 8 words) and a direct imperative description. "
        "Add bounding_box and arrow annotations for key UI elements."
    )

    from services.claude_orchestrator import ORCHESTRATOR_TOOLS

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    system = (
        "You are regenerating a single workflow step. Call create_workflow_step exactly once. "
        "All coordinates are percentages (0-100). "
        "Use color #3B82F6 for primary actions, #F59E0B for caution."
    )

    messages = [{"role": "user", "content": user_msg}]
    new_step_data = None

    for _ in range(5):
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            system=system,
            tools=ORCHESTRATOR_TOOLS,
            messages=messages,
        )
        if response.stop_reason == "end_turn":
            break
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use" and block.name == "create_workflow_step":
                    tool_input = block.input
                    # Preserve original boundaries
                    tool_input["step_number"] = step["step_number"]
                    tool_input["start_ms"] = step["start_ms"]
                    tool_input["end_ms"] = step["end_ms"]
                    tool_input["key_frame_ms"] = (step["start_ms"] + step["end_ms"]) // 2

                    # Update the existing step row instead of creating a new one
                    ts = now_ms()
                    await execute(
                        "UPDATE steps SET title=?, description=?, updated_at=? WHERE id=?",
                        (tool_input["title"], tool_input.get("description", ""), ts, step_id),
                    )

                    # Insert new annotations
                    for ann in tool_input.get("annotations", []):
                        ann_id = new_id()
                        await execute(
                            """INSERT INTO annotations
                               (id, step_id, type, label, x, y, width, height,
                                from_x, from_y, to_x, to_y, color, style, created_at)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (ann_id, step_id, ann.get("type", "bounding_box"), ann.get("label"),
                             ann.get("x"), ann.get("y"), ann.get("width"), ann.get("height"),
                             ann.get("from_x"), ann.get("from_y"), ann.get("to_x"), ann.get("to_y"),
                             ann.get("color", "#3B82F6"), ann.get("style", "solid"), ts),
                        )

                    # Insert new click targets
                    for ct in tool_input.get("click_targets", []):
                        ct_id = new_id()
                        await execute(
                            """INSERT INTO click_targets
                               (id, step_id, element_text, element_type,
                                bbox_x, bbox_y, bbox_width, bbox_height, action, is_primary)
                               VALUES (?,?,?,?,?,?,?,?,?,?)""",
                            (ct_id, step_id, ct.get("element_text"), ct.get("element_type"),
                             ct["bbox_x"], ct["bbox_y"], ct["bbox_width"], ct["bbox_height"],
                             ct.get("action", "left_click"), 1 if ct.get("is_primary") else 0),
                        )

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps({"success": True, "step_id": step_id}),
                    })
                    new_step_data = True
                elif block.type == "tool_use":
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps({"error": "Only create_workflow_step is allowed"}),
                    })

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
            if new_step_data:
                break
        else:
            break

    return {"step": await _get_step(step_id)}


# ─── Review: Segment point ───────────────────────────────────────────────────

@router.post("/api/steps/{step_id}/segment-point")
async def segment_point_on_frame(step_id: str, body: SegmentPointRequest):
    """Click-to-segment: run SAM3 at a point on the step's key frame."""
    from pathlib import Path
    from services.sam3_service import segment_point as sam3_segment_point

    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (step["workflow_id"],))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    # Resolve the key frame to read its bytes
    kf_path = step.get("key_frame_path", "")
    if not kf_path:
        raise HTTPException(400, "Step has no key frame")

    if kf_path.startswith("http"):
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(kf_path)
            resp.raise_for_status()
            frame_bytes = resp.content
    else:
        abs_path = Path(__file__).parent.parent / kf_path
        if not abs_path.exists():
            raise HTTPException(404, "Key frame file not found")
        frame_bytes = abs_path.read_bytes()

    result = await sam3_segment_point(frame_bytes, body.x, body.y)
    if not result:
        return {"segments": [], "frame_path": kf_path}

    return {"segments": result["segments"], "frame_path": kf_path}


# ─── Review: Re-record step ──────────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/steps/{step_id}/re-record")
async def re_record_step(
    workflow_id: str,
    step_id: str,
    video: UploadFile = File(...),
):
    """Replace a step's video segment and re-run analysis."""
    import os
    import shutil
    from pathlib import Path
    from services.video_processor import extract_frames
    from services.yolo_detector import detect_ui_elements

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    step = await fetchone("SELECT * FROM steps WHERE id=? AND workflow_id=?", (step_id, workflow_id))
    if not step:
        raise HTTPException(404, "Step not found")

    # Save the uploaded video segment
    uploads_dir = Path(__file__).parent.parent / "uploads" / workflow_id / "refilm"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    segment_path = uploads_dir / f"step_{step['step_number']}.webm"
    with open(segment_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    # Extract frames from the new segment
    frames = await extract_frames(str(segment_path), workflow_id, prefix=f"refilm_s{step['step_number']}_")
    if not frames:
        raise HTTPException(500, "Failed to extract frames from re-filmed segment")

    # Pick the middle frame as the new key frame
    mid_idx = len(frames) // 2
    key_frame = frames[mid_idx]
    key_frame_path = key_frame.get("relative_path", "")

    # Delete old annotations and click targets
    await execute("DELETE FROM annotations WHERE step_id=?", (step_id,))
    await execute("DELETE FROM click_targets WHERE step_id=?", (step_id,))

    # Update the step with the new key frame
    ts = now_ms()
    await execute(
        "UPDATE steps SET key_frame_path=?, updated_at=? WHERE id=?",
        (key_frame_path, ts, step_id),
    )

    # Run YOLO on the new key frame
    yolo_detections = []
    try:
        yolo_detections = await detect_ui_elements(key_frame["path"])
    except Exception:
        pass

    # Run a quick Claude regeneration for annotations
    import json, anthropic
    from services.claude_orchestrator import ORCHESTRATOR_TOOLS

    yolo_info = [
        {"class": d.get("class"), "bbox": [d.get("bbox_x"), d.get("bbox_y"), d.get("bbox_width"), d.get("bbox_height")]}
        for d in yolo_detections[:10]
    ]

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    user_msg = (
        f"Re-filmed step {step['step_number']} of workflow \"{wf['title']}\".\n"
        f"Original title: \"{step['title']}\"\n"
        f"Original description: \"{step.get('description', '')}\"\n"
        f"YOLO detections: {json.dumps(yolo_info)}\n\n"
        "Create annotations and click targets for this re-filmed step. "
        "Keep the same title and description unless they clearly don't match."
    )

    system = (
        "You are annotating a re-filmed workflow step. Call create_workflow_step exactly once. "
        "Coordinates are percentages (0-100). Use #3B82F6 for primary, #F59E0B for caution."
    )
    messages = [{"role": "user", "content": user_msg}]

    for _ in range(5):
        response = client.messages.create(
            model="claude-sonnet-4-6", max_tokens=2000, system=system,
            tools=ORCHESTRATOR_TOOLS, messages=messages,
        )
        if response.stop_reason == "end_turn":
            break
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use" and block.name == "create_workflow_step":
                    tool_input = block.input
                    await execute(
                        "UPDATE steps SET title=?, description=?, updated_at=? WHERE id=?",
                        (tool_input.get("title", step["title"]),
                         tool_input.get("description", step.get("description", "")),
                         now_ms(), step_id),
                    )
                    for ann in tool_input.get("annotations", []):
                        ann_id = new_id()
                        await execute(
                            """INSERT INTO annotations
                               (id, step_id, type, label, x, y, width, height,
                                from_x, from_y, to_x, to_y, color, style, created_at)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (ann_id, step_id, ann.get("type", "bounding_box"), ann.get("label"),
                             ann.get("x"), ann.get("y"), ann.get("width"), ann.get("height"),
                             ann.get("from_x"), ann.get("from_y"), ann.get("to_x"), ann.get("to_y"),
                             ann.get("color", "#3B82F6"), ann.get("style", "solid"), now_ms()),
                        )
                    for ct in tool_input.get("click_targets", []):
                        ct_id = new_id()
                        await execute(
                            """INSERT INTO click_targets
                               (id, step_id, element_text, element_type,
                                bbox_x, bbox_y, bbox_width, bbox_height, action, is_primary)
                               VALUES (?,?,?,?,?,?,?,?,?,?)""",
                            (ct_id, step_id, ct.get("element_text"), ct.get("element_type"),
                             ct["bbox_x"], ct["bbox_y"], ct["bbox_width"], ct["bbox_height"],
                             ct.get("action", "left_click"), 1 if ct.get("is_primary") else 0),
                        )
                    tool_results.append({
                        "type": "tool_result", "tool_use_id": block.id,
                        "content": json.dumps({"success": True}),
                    })
                    break
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
            break
        else:
            break

    return await _get_step(step_id)


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
