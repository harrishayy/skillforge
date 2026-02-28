import os
import anthropic
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/guided", tags=["guided-recording"])


class StepPromptRequest(BaseModel):
    initial_description: str
    step_number: int
    previous_transcripts: list[str] = []


@router.post("/step-prompt")
async def get_step_prompt(body: StepPromptRequest) -> dict:
    """
    Generate a short LLM-driven guidance prompt for the current recording step.
    Used by the Cluely-style overlay during guided expert recording.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    prev_context = ""
    if body.previous_transcripts:
        summaries = [f"Step {i+1}: {t[:120]}" for i, t in enumerate(body.previous_transcripts)]
        prev_context = "\nPrevious steps covered:\n" + "\n".join(summaries)

    user_msg = (
        f"Workflow description: {body.initial_description}\n"
        f"Current step to record: Step {body.step_number}"
        f"{prev_context}\n\n"
        "Generate a short instruction (max 12 words) for what the expert should speak and demonstrate in this step."
    )

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=60,
        system=(
            "You are a concise recording coach helping a subject-matter expert record a tutorial. "
            "Reply with ONLY a single short sentence (max 12 words) instructing them what to demonstrate next. "
            "No preamble, no quotes, just the instruction."
        ),
        messages=[{"role": "user", "content": user_msg}],
    )

    prompt_text = response.content[0].text.strip().strip('"').strip("'")
    return {"prompt": prompt_text}
