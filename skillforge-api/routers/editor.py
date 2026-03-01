from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from models.database import fetchone, fetchall, execute, execute_many, new_id, now_ms
from models.schemas import (
    StepCreateRequest,
    StepUpdateRequest,
    AnnotationCreateRequest,
    ClickTargetCreateRequest,
    RegenerateStepRequest,
    SegmentPointRequest,
    RerunPipelineRequest,
)

router = APIRouter(tags=["editor"])

_STEP_TOOLS = [
    {
        "name": "create_workflow_step",
        "description": "Create a step in the workflow with all its annotations and click targets. Call this once per step.",
        "input_schema": {
            "type": "object",
            "properties": {
                "step_number": {"type": "integer"},
                "title": {"type": "string", "description": "Short title, max 8 words"},
                "description": {
                    "type": "string",
                    "description": "Direct, actionable instruction for the trainee. Start with a verb.",
                },
                "start_ms": {"type": "integer"},
                "end_ms": {"type": "integer"},
                "key_frame_ms": {"type": "integer", "description": "Timestamp of the most representative frame"},
                "annotations": {
                    "type": "array",
                    "description": "Visual annotations. All coordinates are percentages (0-100).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": ["bounding_box", "arrow", "highlight", "text_label"]},
                            "label": {"type": "string"},
                            "x": {"type": "number"}, "y": {"type": "number"},
                            "width": {"type": "number"}, "height": {"type": "number"},
                            "from_x": {"type": "number"}, "from_y": {"type": "number"},
                            "to_x": {"type": "number"}, "to_y": {"type": "number"},
                            "color": {"type": "string"},
                            "style": {"type": "string", "enum": ["solid", "dashed", "pulse"]},
                        },
                    },
                },
                "click_targets": {
                    "type": "array",
                    "description": "Interactive elements the trainee should interact with.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "element_text": {"type": "string"},
                            "element_type": {"type": "string", "enum": ["button", "input", "menu_item", "link", "icon", "other"]},
                            "bbox_x": {"type": "number"}, "bbox_y": {"type": "number"},
                            "bbox_width": {"type": "number"}, "bbox_height": {"type": "number"},
                            "is_primary": {"type": "boolean"},
                        },
                        "required": ["bbox_x", "bbox_y", "bbox_width", "bbox_height"],
                    },
                },
            },
            "required": ["step_number", "title", "description", "start_ms", "end_ms", "key_frame_ms"],
        },
    },
]


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

    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (step["workflow_id"],))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    await execute("DELETE FROM annotations WHERE step_id=?", (step_id,))
    await execute("DELETE FROM click_targets WHERE step_id=?", (step_id,))

    context_line = f'Additional context from expert: "{body.additional_context}"' if body.additional_context else ""
    user_msg = (
        f"Regenerate step {step['step_number']} of workflow \"{wf['title']}\".\n"
        f"Workflow description: {wf.get('description', 'N/A')}\n"
        f"Current title: \"{step['title']}\"\n"
        f"Current description: \"{step.get('description', '')}\"\n"
        f"Time range: {step['start_ms']}ms – {step['end_ms']}ms\n"
        f"{context_line}\n\n"
        "Create an improved version of this step by calling create_workflow_step. "
        "Use a concise title (max 8 words) and a direct imperative description. "
        "Add bounding_box and arrow annotations for key UI elements."
    )

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
            tools=_STEP_TOOLS,
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


# ─── Review: Auto-segment with step context ─────────────────────────────────

@router.post("/api/steps/{step_id}/auto-segment")
async def auto_segment_step(step_id: str):
    """Run SAM3 text-prompted segmentation using step context as the prompt."""
    from pathlib import Path
    from services.sam3_service import segment_with_context

    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    kf_path = step.get("key_frame_path", "")
    if not kf_path:
        raise HTTPException(400, "Step has no key frame")

    frame_bytes = await _read_frame_bytes(kf_path)
    result = await segment_with_context(
        frame_bytes,
        title=step.get("title", ""),
        description=step.get("description", ""),
        transcript=step.get("ai_description", ""),
    )

    segments = result["segments"] if result else []
    return {"segments": segments, "frame_path": kf_path}


# ─── Review: Segment point (add/remove toggle) ──────────────────────────────

@router.post("/api/steps/{step_id}/segment-point")
async def segment_point_on_frame(step_id: str, body: SegmentPointRequest):
    """Click-to-segment with add/remove toggle on the step's key frame."""
    from pathlib import Path
    from services.sam3_service import (
        segment_point as sam3_segment_point,
        toggle_segment,
    )

    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    kf_path = step.get("key_frame_path", "")
    if not kf_path:
        raise HTTPException(400, "Step has no key frame")

    frame_bytes = await _read_frame_bytes(kf_path)

    if body.existing_segments:
        result = await toggle_segment(frame_bytes, body.x, body.y, body.existing_segments)
        return {
            "segments": result["segments"],
            "removed_index": result["removed_index"],
            "frame_path": kf_path,
        }

    result = await sam3_segment_point(frame_bytes, body.x, body.y)
    if not result:
        return {"segments": [], "frame_path": kf_path}

    return {"segments": result["segments"], "frame_path": kf_path}


# ─── Review: Rerun multi-agent pipeline for a single step ────────────────────

@router.post("/api/steps/{step_id}/rerun-pipeline")
async def rerun_step_pipeline(step_id: str, body: RerunPipelineRequest):
    """Re-run configurable agents (Claude / Nemotron / SAM3) for a single step."""
    from pathlib import Path
    from services.key_object_pipeline import (
        identify_key_object,
        scan_frames_for_object,
        segment_positive_frames,
    )

    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (step["workflow_id"],))
    wf_title = wf["title"] if wf else ""
    wf_description = wf.get("description", "") if wf else ""

    frames = await fetchall(
        "SELECT * FROM step_frames WHERE step_id=? ORDER BY timestamp_ms",
        (step_id,),
    )
    if not frames:
        raise HTTPException(400, "Step has no frames")

    uploads_dir = Path(__file__).parent.parent
    frame_paths = [str(uploads_dir / f["frame_path"]) for f in frames]
    frame_id_by_path = {str(uploads_dir / f["frame_path"]): f["id"] for f in frames}

    key_object = None

    # Agent 1: Claude — re-identify key object
    if body.run_claude:
        key_object = await identify_key_object(
            step_title=step.get("title", ""),
            step_description=step.get("description", ""),
            transcript=step.get("transcript", ""),
            note=step.get("note", ""),
            workflow_title=wf_title,
            workflow_description=wf_description,
        )
        sam3_prompt = key_object.get("sam3_prompt", "")
        if sam3_prompt:
            await execute(
                "UPDATE steps SET sam3_prompt=?, updated_at=? WHERE id=?",
                (sam3_prompt, now_ms(), step_id),
            )

    # Build key_object from existing data if Claude was skipped
    if key_object is None:
        key_object = {
            "key_object": step.get("title", "object"),
            "object_type": "other",
            "visual_cues": "",
            "action": "",
            "sam3_prompt": step.get("sam3_prompt", step.get("title", "object")),
        }

    # Agent 2: Nemotron — re-scan frames for object presence
    if body.run_nemotron:
        frame_detections = await scan_frames_for_object(
            frame_paths, key_object,
        )
        for detection in frame_detections:
            fid = frame_id_by_path.get(detection["frame_path"])
            if fid:
                await execute(
                    "UPDATE step_frames SET object_detected=?, object_description=? WHERE id=?",
                    (1 if detection["present"] else 0, detection.get("description", ""), fid),
                )

    # Agent 3: SAM3 — re-segment positive frames
    if body.run_sam3:
        import base64 as b64mod, shutil
        from services.sam3_service import generate_segmented_image

        # Clean up old masks and segmented images
        await execute("DELETE FROM click_targets WHERE step_id=?", (step_id,))

        masks_dir = uploads_dir / "uploads" / step["workflow_id"] / "masks" / step_id
        if masks_dir.exists():
            shutil.rmtree(masks_dir)
        masks_dir.mkdir(parents=True, exist_ok=True)

        seg_dir = uploads_dir / "uploads" / step["workflow_id"] / "segmented" / step_id
        if seg_dir.exists():
            shutil.rmtree(seg_dir)

        # Clear old segmented_frame_path values
        await execute(
            "UPDATE step_frames SET segmented_frame_path=NULL WHERE step_id=?",
            (step_id,),
        )

        refreshed_frames = await fetchall(
            "SELECT * FROM step_frames WHERE step_id=? ORDER BY timestamp_ms",
            (step_id,),
        )
        positive_frames = [
            {"frame_path": str(uploads_dir / f["frame_path"])}
            for f in refreshed_frames
            if f.get("object_detected")
        ]
        frame_id_by_abs = {
            str(uploads_dir / f["frame_path"]): f["id"]
            for f in refreshed_frames
        }

        if positive_frames:
            sam3_prompt = key_object.get("sam3_prompt", step.get("sam3_prompt", ""))
            segmentations = await segment_positive_frames(positive_frames, sam3_prompt)

            seg_by_frame: dict[str, list[dict]] = {}
            for seg_result in segmentations:
                seg_frame_abs = seg_result.get("frame_path", "")
                seg_frame_rel = str(Path(seg_frame_abs).relative_to(uploads_dir)) if seg_frame_abs else None

                if seg_frame_abs:
                    seg_by_frame.setdefault(seg_frame_abs, []).extend(seg_result["segments"])

                for seg in seg_result["segments"]:
                    bbox = seg.get("bbox", [0, 0, 0, 0])
                    ct_id = new_id()

                    mask_path = None
                    mask_b64 = seg.get("mask_base64")
                    if mask_b64:
                        mask_file = masks_dir / f"{ct_id}.png"
                        mask_file.write_bytes(b64mod.b64decode(mask_b64))
                        mask_path = str(mask_file.relative_to(uploads_dir))

                    await execute(
                        """INSERT INTO click_targets
                           (id, step_id, element_text, element_type,
                            bbox_x, bbox_y, bbox_width, bbox_height,
                            action, confidence, is_primary, mask_path, frame_path)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            ct_id, step_id,
                            key_object.get("key_object", step.get("title", "")),
                            key_object.get("object_type", "other"),
                            bbox[0] * 100, bbox[1] * 100,
                            (bbox[2] - bbox[0]) * 100, (bbox[3] - bbox[1]) * 100,
                            "left_click", seg.get("score", 0), 0,
                            mask_path, seg_frame_rel,
                        ),
                    )

            # Generate pre-rendered segmented images
            obj_label = key_object.get("key_object", "")
            for frame_abs, segs in seg_by_frame.items():
                fid = frame_id_by_abs.get(frame_abs)
                if not fid or not segs:
                    continue
                out_file = seg_dir / f"{fid}.jpg"
                result_path = generate_segmented_image(
                    frame_abs, segs, str(out_file), label=obj_label,
                )
                if result_path:
                    seg_rel = str(Path(result_path).relative_to(uploads_dir))
                    await execute(
                        "UPDATE step_frames SET segmented_frame_path=? WHERE id=?",
                        (seg_rel, fid),
                    )

    return await _get_step_with_frames(step_id)


async def _read_frame_bytes(kf_path: str) -> bytes:
    """Read key frame bytes from a local path."""
    from pathlib import Path
    abs_path = Path(__file__).parent.parent / kf_path
    if not abs_path.exists():
        raise HTTPException(404, "Key frame file not found")
    return abs_path.read_bytes()


# ─── Review: Re-record step ──────────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/steps/{step_id}/re-record")
async def re_record_step(
    workflow_id: str,
    step_id: str,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
):
    """Replace a step's video segment, re-run analysis, and invalidate downstream contexts."""
    import os
    import shutil
    from pathlib import Path
    from services.video_processor import extract_frames
    from services.memory_layer import invalidate_contexts_from

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    step = await fetchone("SELECT * FROM steps WHERE id=? AND workflow_id=?", (step_id, workflow_id))
    if not step:
        raise HTTPException(404, "Step not found")

    uploads_dir = Path(__file__).parent.parent / "uploads" / workflow_id / "refilm"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    segment_path = uploads_dir / f"step_{step['step_number']}.webm"
    with open(segment_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    frames = await extract_frames(str(segment_path), workflow_id)
    if not frames:
        raise HTTPException(500, "Failed to extract frames from re-filmed segment")

    mid_idx = len(frames) // 2
    key_frame = frames[mid_idx]
    key_frame_path = key_frame.get("relative_path", "")

    await execute("DELETE FROM annotations WHERE step_id=?", (step_id,))
    await execute("DELETE FROM click_targets WHERE step_id=?", (step_id,))

    invalidated = await invalidate_contexts_from(workflow_id, step["step_number"])

    ts = now_ms()
    await execute(
        "UPDATE steps SET key_frame_path=?, updated_at=? WHERE id=?",
        (key_frame_path, ts, step_id),
    )

    import json, anthropic

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    user_msg = (
        f"Re-filmed step {step['step_number']} of workflow \"{wf['title']}\".\n"
        f"Original title: \"{step['title']}\"\n"
        f"Original description: \"{step.get('description', '')}\"\n\n"
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
            tools=_STEP_TOOLS, messages=messages,
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

    if invalidated and len(invalidated) > 1:
        background_tasks.add_task(
            _rebuild_downstream_contexts,
            workflow_id,
            step["step_number"] + 1,
        )

    return await _get_step(step_id)


# ─── Apparatus object editing ─────────────────────────────────────────────────

@router.patch("/api/apparatus-objects/{object_id}")
async def update_apparatus_object(object_id: str, body: dict):
    """Update editable fields on an apparatus object."""
    row = await fetchone("SELECT * FROM workflow_objects WHERE id=?", (object_id,))
    if not row:
        raise HTTPException(404, "Apparatus object not found")

    allowed = {"object_name", "description", "visual_cues", "sam3_prompt"}
    updates = {k: v for k, v in body.items() if k in allowed and v is not None}
    if not updates:
        raise HTTPException(400, "No valid fields to update")

    set_clauses = ", ".join(f"{k}=${i+1}" for i, k in enumerate(updates))
    values = list(updates.values()) + [object_id]
    await execute(
        f"UPDATE workflow_objects SET {set_clauses} WHERE id=${len(values)}",
        tuple(values),
    )

    updated = await fetchone("SELECT * FROM workflow_objects WHERE id=?", (object_id,))
    import json as _json
    raw = updated.get("reference_frame_paths")
    if isinstance(raw, str):
        try:
            updated["reference_frame_paths"] = _json.loads(raw)
        except Exception:
            updated["reference_frame_paths"] = []
    elif raw is None:
        updated["reference_frame_paths"] = []
    return updated


# ─── Rebuild all memories ─────────────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/rebuild-memories")
async def rebuild_memories(workflow_id: str, background_tasks: BackgroundTasks):
    """Invalidate all step contexts and re-run the multi-agent pipeline for every step."""
    from services.memory_layer import invalidate_contexts_from

    wf = await fetchone("SELECT * FROM workflows WHERE id=?", (workflow_id,))
    if not wf:
        raise HTTPException(404, "Workflow not found")

    steps = await fetchall(
        "SELECT * FROM steps WHERE workflow_id=? ORDER BY step_number",
        (workflow_id,),
    )
    steps_count = len(steps)
    if steps_count == 0:
        return {"status": "no_steps", "steps_count": 0}

    await invalidate_contexts_from(workflow_id, 1)
    background_tasks.add_task(_rebuild_downstream_contexts, workflow_id, 1)

    return {"status": "rebuilding", "steps_count": steps_count}


# ─── Context rebuild for downstream steps after re-record ────────────────────

async def _rebuild_downstream_contexts(workflow_id: str, from_step: int):
    """
    Re-run the multi-agent pipeline for steps from_step..N to rebuild
    their context documents after an upstream step was re-recorded.
    """
    from services.memory_layer import build_step_context, update_context_with_observations
    from services.key_object_pipeline import run_key_object_analysis_multi

    steps = await fetchall(
        "SELECT * FROM steps WHERE workflow_id=? AND step_number>=? ORDER BY step_number",
        (workflow_id, from_step),
    )
    for step in steps:
        try:
            context = await build_step_context(workflow_id, step["step_number"])
            frames = await fetchall(
                "SELECT * FROM step_frames WHERE step_id=? ORDER BY timestamp_ms",
                (step["id"],),
            )
            if not frames:
                continue

            from pathlib import Path
            uploads_dir = Path(__file__).parent.parent / "uploads"
            frame_paths = [str(uploads_dir.parent / f["frame_path"]) for f in frames]

            analysis = await run_key_object_analysis_multi(
                frame_paths=frame_paths,
                step_title=step.get("title", ""),
                step_description=step.get("description", ""),
                transcript=step.get("transcript", ""),
                note=step.get("note", ""),
                context=context,
            )

            await update_context_with_observations(
                workflow_id=workflow_id,
                step_number=step["step_number"],
                objects_identified=analysis["target_objects"],
                frame_observations=[
                    det for dets in analysis["detection_results"].values() for det in dets
                ],
                new_observations=step.get("ai_description", ""),
            )

            print(
                f"[Editor] Rebuilt context for step {step['step_number']} in workflow {workflow_id}",
                flush=True,
            )
        except Exception as e:
            print(
                f"[Editor] Failed to rebuild context for step {step['step_number']}: {e}",
                flush=True,
            )


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_step(step_id: str) -> dict:
    step = await fetchone("SELECT * FROM steps WHERE id=?", (step_id,))
    annotations = await fetchall("SELECT * FROM annotations WHERE step_id=? ORDER BY created_at", (step_id,))
    click_targets = await fetchall("SELECT * FROM click_targets WHERE step_id=?", (step_id,))
    for ct in click_targets:
        ct["is_primary"] = bool(ct["is_primary"])
    return {**step, "annotations": annotations, "click_targets": click_targets}


async def _get_step_with_frames(step_id: str) -> dict:
    step = await _get_step(step_id)
    frames = await fetchall(
        "SELECT * FROM step_frames WHERE step_id=? ORDER BY timestamp_ms",
        (step_id,),
    )
    for f in frames:
        f["is_key_frame"] = bool(f.get("is_key_frame", 0))
        f["object_detected"] = bool(f.get("object_detected", 0))
    step["frames"] = frames
    return step
