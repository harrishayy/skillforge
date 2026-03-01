import os
from typing import Optional

import anthropic
from fastapi import APIRouter
from pydantic import BaseModel

from services.memory_layer import get_apparatus_catalog

router = APIRouter(prefix="/api/guided", tags=["guided-recording"])


class StepPromptRequest(BaseModel):
    initial_description: str
    step_number: int
    previous_transcripts: list[str] = []
    workflow_id: Optional[str] = None


@router.post("/step-prompt")
async def get_step_prompt(body: StepPromptRequest) -> dict:
    """
    Generate a short LLM-driven guidance prompt for the current recording step.
    Used by the Cluely-style overlay during guided expert recording.

    When workflow_id is provided and an apparatus catalog exists, the prompt
    can reference specific tools/parts the expert should demonstrate.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    prev_context = ""
    if body.previous_transcripts:
        summaries = [f"Step {i+1}: {t[:120]}" for i, t in enumerate(body.previous_transcripts)]
        prev_context = "\nPrevious steps covered:\n" + "\n".join(summaries)

    apparatus_context = ""
    if body.workflow_id:
        try:
            catalog = await get_apparatus_catalog(body.workflow_id)
            if catalog:
                obj_names = [o["object_name"] for o in catalog]
                apparatus_context = (
                    "\nAvailable tools/parts (from apparatus showcase): "
                    + ", ".join(obj_names)
                )
        except Exception:
            pass

    user_msg = (
        f"Workflow description: {body.initial_description}\n"
        f"Current step to record: Step {body.step_number}"
        f"{prev_context}"
        f"{apparatus_context}\n\n"
        "Generate a short instruction (max 12 words) for what the expert should speak and demonstrate in this step."
    )

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=60,
        system=(
            "You are a concise recording coach helping a subject-matter expert record a tutorial. "
            "Reply with ONLY a single short sentence (max 12 words) instructing them what to demonstrate next. "
            "If available tools/parts are listed, reference specific ones relevant to this step. "
            "No preamble, no quotes, just the instruction."
        ),
        messages=[{"role": "user", "content": user_msg}],
    )

    prompt_text = response.content[0].text.strip().strip('"').strip("'")
    return {"prompt": prompt_text}
