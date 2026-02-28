"""
SOFTWARE WORKFLOW — Claude agentic tool-use loop for decomposing screen recordings.
Used exclusively by: services/workflow_builder.py (software pipeline).

Physical workflow VLM decomposition is inline in: services/physical_pipeline.py
"""
import os
import json
import anthropic
from models.database import execute, fetchall, new_id, now_ms
from websockets.pipeline_ws import broadcast
from utils.event_mapper import events_to_summary

ORCHESTRATOR_TOOLS = [
    {
        "name": "get_frame_analysis",
        "description": "Retrieve the full Nemotron VL analysis for a specific frame by its timestamp in milliseconds.",
        "input_schema": {
            "type": "object",
            "properties": {
                "timestamp_ms": {
                    "type": "integer",
                    "description": "Frame timestamp in milliseconds",
                }
            },
            "required": ["timestamp_ms"],
        },
    },
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
                    "description": "Direct, actionable instruction for the trainee. Start with a verb. E.g. 'Click the File menu in the top-left corner'",
                },
                "start_ms": {"type": "integer"},
                "end_ms": {"type": "integer"},
                "key_frame_ms": {
                    "type": "integer",
                    "description": "Timestamp of the most representative frame for this step",
                },
                "annotations": {
                    "type": "array",
                    "description": "Visual annotations for the key frame. All coordinates are percentages (0-100) of frame dimensions.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["bounding_box", "arrow", "highlight", "text_label"],
                            },
                            "label": {"type": "string"},
                            "x": {"type": "number"},
                            "y": {"type": "number"},
                            "width": {"type": "number"},
                            "height": {"type": "number"},
                            "from_x": {"type": "number"},
                            "from_y": {"type": "number"},
                            "to_x": {"type": "number"},
                            "to_y": {"type": "number"},
                            "color": {"type": "string", "description": "hex color, default #3B82F6"},
                            "style": {
                                "type": "string",
                                "enum": ["solid", "dashed", "pulse"],
                            },
                        },
                    },
                },
                "click_targets": {
                    "type": "array",
                    "description": "Interactive UI elements the trainee should click. Software mode only.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "element_text": {"type": "string"},
                            "element_type": {
                                "type": "string",
                                "enum": ["button", "input", "menu_item", "link", "icon", "other"],
                            },
                            "bbox_x": {"type": "number"},
                            "bbox_y": {"type": "number"},
                            "bbox_width": {"type": "number"},
                            "bbox_height": {"type": "number"},
                            "is_primary": {
                                "type": "boolean",
                                "description": "true for the main element to interact with in this step",
                            },
                        },
                        "required": ["bbox_x", "bbox_y", "bbox_width", "bbox_height"],
                    },
                },
            },
            "required": ["step_number", "title", "description", "start_ms", "end_ms", "key_frame_ms"],
        },
    },
]


def _build_frame_summary(frame_analyses: list[dict]) -> list[dict]:
    summary = []
    for fa in frame_analyses:
        vl = fa.get("vl_analysis", {})
        summary.append(
            {
                "timestamp_ms": fa["timestamp_ms"],
                "step_boundary": vl.get("step_boundary", False),
                "current_action": vl.get("current_action", ""),
                "app_name": vl.get("app_name", ""),
                "ui_element_count": len(vl.get("ui_elements", [])),
                "input_events": events_to_summary(fa.get("input_events", [])),
            }
        )
    return summary


async def _execute_tool(
    tool_name: str,
    tool_input: dict,
    workflow_id: str,
    frame_analyses: list[dict],
) -> str:
    if tool_name == "get_frame_analysis":
        ts = tool_input["timestamp_ms"]
        # Find closest frame
        closest = min(frame_analyses, key=lambda f: abs(f["timestamp_ms"] - ts))
        return json.dumps(closest)

    if tool_name == "create_workflow_step":
        step_id = new_id()
        ts = now_ms()

        # Find the key frame path
        kf_ms = tool_input.get("key_frame_ms", tool_input["start_ms"])
        closest = min(frame_analyses, key=lambda f: abs(f["timestamp_ms"] - kf_ms))
        key_frame_path = closest.get("relative_path", "")

        await execute(
            """INSERT INTO steps
               (id, workflow_id, step_number, title, description,
                start_ms, end_ms, key_frame_path, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                step_id,
                workflow_id,
                tool_input["step_number"],
                tool_input["title"],
                tool_input.get("description", ""),
                tool_input["start_ms"],
                tool_input["end_ms"],
                key_frame_path,
                ts,
                ts,
            ),
        )

        # Insert annotations
        annotations_saved = []
        for ann in tool_input.get("annotations", []):
            ann_id = new_id()
            await execute(
                """INSERT INTO annotations
                   (id, step_id, type, label, x, y, width, height,
                    from_x, from_y, to_x, to_y, color, style, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    ann_id,
                    step_id,
                    ann.get("type", "bounding_box"),
                    ann.get("label"),
                    ann.get("x"),
                    ann.get("y"),
                    ann.get("width"),
                    ann.get("height"),
                    ann.get("from_x"),
                    ann.get("from_y"),
                    ann.get("to_x"),
                    ann.get("to_y"),
                    ann.get("color", "#3B82F6"),
                    ann.get("style", "solid"),
                    ts,
                ),
            )
            annotations_saved.append({**ann, "id": ann_id})

        # Insert click targets
        click_targets_saved = []
        for ct in tool_input.get("click_targets", []):
            ct_id = new_id()
            await execute(
                """INSERT INTO click_targets
                   (id, step_id, element_text, element_type,
                    bbox_x, bbox_y, bbox_width, bbox_height, action, is_primary)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    ct_id,
                    step_id,
                    ct.get("element_text"),
                    ct.get("element_type"),
                    ct["bbox_x"],
                    ct["bbox_y"],
                    ct["bbox_width"],
                    ct["bbox_height"],
                    ct.get("action", "left_click"),
                    1 if ct.get("is_primary") else 0,
                ),
            )
            click_targets_saved.append({**ct, "id": ct_id})

        step_data = {
            "id": step_id,
            "step_number": tool_input["step_number"],
            "title": tool_input["title"],
            "description": tool_input.get("description", ""),
            "start_ms": tool_input["start_ms"],
            "end_ms": tool_input["end_ms"],
            "key_frame_path": key_frame_path,
            "annotations": annotations_saved,
            "click_targets": click_targets_saved,
        }

        # Broadcast live step creation to WebSocket clients
        await broadcast(workflow_id, {"type": "step_created", "step": step_data})

        return json.dumps({"success": True, "step_id": step_id})

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


async def decompose_workflow(
    workflow_id: str,
    frame_analyses: list[dict],
    on_progress=None,
    step_markers: list[dict] | None = None,
    step_transcripts: list[str] | None = None,
) -> int:
    """
    Run Claude in an agentic tool-use loop to decompose a software screen recording
    into workflow steps. Returns the number of steps created.

    When step_markers are provided (guided recording), step boundaries are pre-defined
    by the expert. Claude's role is reduced to generating annotations/click targets
    and deriving titles/descriptions from the expert's voice transcripts.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    guided_mode = bool(step_markers)

    if guided_mode:
        return await _decompose_guided(
            client, workflow_id, frame_analyses, step_markers, step_transcripts or [], on_progress
        )

    # ── Standard (auto-discover) mode ────────────────────────────────────────
    frame_summary = _build_frame_summary(frame_analyses)
    total_duration_ms = max((f["timestamp_ms"] for f in frame_analyses), default=0)

    system = f"""You are a workflow decomposition expert analyzing a software screen recording.
The video is {total_duration_ms / 1000:.1f} seconds long with {len(frame_analyses)} extracted frames.

Your task:
1. Review the frame analysis summary below
2. Use get_frame_analysis to inspect specific frames when you need visual detail
3. Identify logical step boundaries — look for step_boundary=true signals, app/context changes, and distinct action transitions
4. Call create_workflow_step for EACH step in order

Rules:
- Write descriptions as direct imperatives: "Click the File menu in the top-left corner"
- Keep titles short (max 8 words)
- Merge trivial sequential micro-actions into one step
- Create at most 15 steps total
- For annotations: use bounding_box around the target element, arrow from center pointing to it
- All coordinates are percentages (0-100) relative to frame dimensions
- For arrows: from_x/from_y is guide arrow start, to_x/to_y points to target
- Use color #3B82F6 (blue) for primary actions, #F59E0B (amber) for warnings/caution
- IMPORTANT: Process all frames and create the COMPLETE workflow before stopping"""

    messages = [
        {
            "role": "user",
            "content": f"Frame analysis summary ({len(frame_summary)} frames):\n{json.dumps(frame_summary, indent=2)}\n\nPlease decompose this recording into a complete workflow.",
        }
    ]

    if on_progress:
        await on_progress("Claude is analyzing the workflow...", 65)

    steps_created = 0
    iterations = 0
    max_iterations = 30  # safety limit

    while iterations < max_iterations:
        iterations += 1
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8000,
            system=system,
            tools=ORCHESTRATOR_TOOLS,
            messages=messages,
        )

        if response.stop_reason == "end_turn":
            break

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = await _execute_tool(
                        block.name, block.input, workflow_id, frame_analyses
                    )
                    if block.name == "create_workflow_step":
                        steps_created += 1
                        pct = 65 + min(int((steps_created / 15) * 30), 30)
                        if on_progress:
                            await on_progress(
                                f"Step {steps_created} created: {block.input.get('title', '')}",
                                pct,
                            )
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        }
                    )

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        else:
            break

    return steps_created


async def _decompose_guided(
    client: anthropic.Anthropic,
    workflow_id: str,
    frame_analyses: list[dict],
    step_markers: list[dict],
    step_transcripts: list[str],
    on_progress=None,
) -> int:
    """
    Guided-mode decomposition: step boundaries are already defined by the expert.
    For each segment, Claude generates annotations and derives title/description
    from the expert's voice transcript.
    """
    if on_progress:
        await on_progress("Processing expert-defined steps...", 65)

    steps_created = 0

    for i, marker in enumerate(step_markers):
        step_number = marker.get("step_number", i + 1)
        start_ms = marker["start_ms"]
        end_ms = marker["end_ms"]
        transcript = step_transcripts[i] if i < len(step_transcripts) else ""

        # Frames within this step's time range
        segment_frames = [
            f for f in frame_analyses
            if start_ms <= f["timestamp_ms"] <= end_ms
        ]
        # Fallback: pick the closest frame to start_ms if none fall in range
        if not segment_frames and frame_analyses:
            segment_frames = [min(frame_analyses, key=lambda f: abs(f["timestamp_ms"] - start_ms))]

        # Choose key frame as the one closest to the midpoint of the step
        mid_ms = (start_ms + end_ms) // 2
        key_frame = min(segment_frames, key=lambda f: abs(f["timestamp_ms"] - mid_ms))
        key_frame_path = key_frame.get("relative_path", "")

        # Ask Claude to generate title, description, and annotations for this single step
        transcript_context = f'Expert narration: "{transcript}"' if transcript else "No narration captured."
        yolo_info = [
            {"class": d.get("class"), "bbox": [d.get("bbox_x"), d.get("bbox_y"), d.get("bbox_width"), d.get("bbox_height")], "conf": round(d.get("confidence", 0), 2)}
            for d in key_frame.get("yolo_detections", [])[:10]
        ]

        user_msg = (
            f"Step {step_number} of the guided recording.\n"
            f"Time range: {start_ms}ms – {end_ms}ms\n"
            f"{transcript_context}\n"
            f"YOLO detections on key frame: {json.dumps(yolo_info)}\n\n"
            "Using the transcript as the primary source, create this workflow step by calling create_workflow_step. "
            "Extract a concise title (≤8 words) from the transcript. "
            "Write a direct imperative description. "
            "Add bounding_box + arrow annotations for any visible UI elements the expert interacted with."
        )

        messages = [{"role": "user", "content": user_msg}]

        system = (
            "You are annotating a single step of an expert-recorded tutorial. "
            "Step boundaries are pre-defined. Use the transcript for title and description. "
            "Call create_workflow_step exactly once. "
            "All coordinates are percentages (0-100) of frame dimensions. "
            "Use color #3B82F6 for primary actions, #F59E0B for caution."
        )

        # Single-pass: call Claude once per step (no discovery loop needed)
        for _ in range(5):  # safety limit per step
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
                    if block.type == "tool_use":
                        # Inject pre-defined boundaries before executing the tool
                        if block.name == "create_workflow_step":
                            block.input["step_number"] = step_number
                            block.input["start_ms"] = start_ms
                            block.input["end_ms"] = end_ms
                            block.input["key_frame_ms"] = key_frame["timestamp_ms"]
                        result = await _execute_tool(
                            block.name, block.input, workflow_id, segment_frames
                        )
                        if block.name == "create_workflow_step":
                            steps_created += 1
                            pct = 65 + min(int((steps_created / max(len(step_markers), 1)) * 30), 30)
                            if on_progress:
                                await on_progress(
                                    f"Step {step_number} created: {block.input.get('title', '')}",
                                    pct,
                                )
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        })

                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": tool_results})

                # Stop after step created
                if any(b.type == "tool_use" and b.name == "create_workflow_step" for b in response.content):
                    break
            else:
                break

    return steps_created
