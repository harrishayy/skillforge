"""
SOFTWARE WORKFLOW — Claude streaming copilot for trainees replaying screen-recording workflows.
Queries software DB tables: steps, click_targets.
Physical live guidance is in: services/live_guidance_service.py
"""
import os
import json
from typing import AsyncGenerator
import anthropic
from models.database import fetchone, fetchall

COPILOT_TOOLS = [
    {
        "name": "get_step_details",
        "description": "Get the full details, description, and click targets for any workflow step by step number.",
        "input_schema": {
            "type": "object",
            "properties": {
                "step_number": {"type": "integer"}
            },
            "required": ["step_number"],
        },
    },
    {
        "name": "get_all_steps",
        "description": "Get a summary list of all steps in the workflow.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


async def _execute_copilot_tool(
    tool_name: str, tool_input: dict, workflow_id: str
) -> str:
    if tool_name == "get_all_steps":
        steps = await fetchall(
            "SELECT step_number, title, description FROM steps WHERE workflow_id=? ORDER BY step_number",
            (workflow_id,),
        )
        return json.dumps(steps)

    if tool_name == "get_step_details":
        step_number = tool_input["step_number"]
        step = await fetchone(
            "SELECT * FROM steps WHERE workflow_id=? AND step_number=?",
            (workflow_id, step_number),
        )
        if not step:
            return json.dumps({"error": f"Step {step_number} not found"})

        click_targets = await fetchall(
            "SELECT * FROM click_targets WHERE step_id=?", (step["id"],)
        )
        return json.dumps({**step, "click_targets": click_targets})

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


async def stream_step_instruction(
    workflow_id: str, step: dict
) -> AsyncGenerator[str, None]:
    """Generate a concise instruction for a step (non-streaming, returns full text)."""
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    click_targets = await fetchall(
        "SELECT element_text, element_type, is_primary FROM click_targets WHERE step_id=? AND is_primary=1",
        (step["id"],),
    )
    primary_target = click_targets[0] if click_targets else None
    target_hint = (
        f" The primary element to interact with is: {primary_target['element_text']} ({primary_target['element_type']})"
        if primary_target
        else ""
    )

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=256,
        messages=[
            {
                "role": "user",
                "content": f"You are a training copilot. Give a single clear sentence instruction for this step.\nStep title: {step['title']}\nStep description: {step.get('description', '')}{target_hint}\n\nRespond with ONLY the instruction sentence, no preamble.",
            }
        ],
    )

    for block in response.content:
        if hasattr(block, "text"):
            yield block.text
            return

    yield step.get("description", step["title"])


async def stream_chat_response(
    workflow_id: str,
    step: dict,
    user_message: str,
    chat_history: list[dict],
) -> AsyncGenerator[str, None]:
    """Stream Claude's response to a trainee chat message."""
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    system = f"""You are a friendly, concise training copilot helping a trainee complete a task.

Current step: Step {step['step_number']} — "{step['title']}"
Instructions: {step.get('description', '')}

Your role:
- Answer questions about what to do next clearly and specifically
- Reference UI elements by name when relevant (e.g., "the blue Save button in the toolbar")
- Keep responses under 3 sentences unless the trainee explicitly asks for more detail
- Be encouraging and supportive
- If you need more context about other steps, use the available tools

Workflow ID: {workflow_id}"""

    messages = chat_history + [{"role": "user", "content": user_message}]

    # First, check if tool use is needed (non-streaming pass)
    check_response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        tools=COPILOT_TOOLS,
        messages=messages,
    )

    # Execute any tool calls
    if check_response.stop_reason == "tool_use":
        tool_results = []
        for block in check_response.content:
            if block.type == "tool_use":
                result = await _execute_copilot_tool(block.name, block.input, workflow_id)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })
        messages.append({"role": "assistant", "content": check_response.content})
        messages.append({"role": "user", "content": tool_results})

    # Stream the final response
    with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=system,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield text
