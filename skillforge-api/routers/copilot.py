import json
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from models.database import fetchone
from models.schemas import CopilotChatRequest, StepInstructionRequest
from services.claude_copilot import stream_chat_response, stream_step_instruction

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


@router.post("/step-instruction")
async def get_step_instruction(body: StepInstructionRequest):
    step = await fetchone("SELECT * FROM steps WHERE id=?", (body.step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    instruction_parts = []
    async for chunk in stream_step_instruction(body.workflow_id, step):
        instruction_parts.append(chunk)

    return {"instruction": "".join(instruction_parts)}


@router.post("/chat")
async def copilot_chat(body: CopilotChatRequest):
    step = await fetchone("SELECT * FROM steps WHERE id=?", (body.step_id,))
    if not step:
        raise HTTPException(404, "Step not found")

    async def event_stream():
        async for chunk in stream_chat_response(
            workflow_id=body.workflow_id,
            step=step,
            user_message=body.message,
            chat_history=body.chat_history,
        ):
            yield f"data: {json.dumps({'token': chunk})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
