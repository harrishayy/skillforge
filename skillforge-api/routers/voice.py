"""
Voice intent classification for step navigation commands.
LLM fallback when client-side regex/fuzzy matcher returns null on long transcripts.
"""
import os
import re
import anthropic
from fastapi import APIRouter
from models.schemas import VoiceIntentRequest

router = APIRouter(prefix="/api/voice", tags=["voice"])

INTENT_PROMPT = """You classify voice transcripts for a step-based tutorial/recording app.

The user may say things like:
- To go to the next step: "next step", "skip", "continue", "go to the next phase", "advance"
- To go to the previous step: "previous step", "go back", "back", "last step"
- To finish/end: "finish", "done", "complete", "end recording", "stop recording"

Respond with EXACTLY one word: next, prev, finish, or none.
- next: user wants to advance to the next step
- prev: user wants to go back to the previous step
- finish: user wants to end/finish the current session
- none: unclear or unrelated to step navigation

User transcript:
"""


@router.post("/intent")
async def classify_intent(body: VoiceIntentRequest) -> dict:
    transcript = (body.transcript or "").strip()
    if not transcript:
        return {"intent": "none"}

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=32,
        messages=[{"role": "user", "content": INTENT_PROMPT + transcript}],
    )

    raw = ""
    for block in response.content:
        if hasattr(block, "text"):
            raw = block.text.strip().lower()
            break

    match = re.search(r"\b(next|prev|finish|none)\b", raw)
    intent = match.group(1) if match else "none"

    return {"intent": intent}
