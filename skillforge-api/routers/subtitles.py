from fastapi import APIRouter, HTTPException
from models.database import fetchall
from models.schemas import SubtitleSegmentResponse

router = APIRouter()


@router.get("/api/steps/{step_id}/subtitles")
async def get_step_subtitles(step_id: str) -> dict:
    rows = await fetchall(
        "SELECT id, step_id, start_ms, end_ms, text FROM subtitles WHERE step_id=? ORDER BY start_ms",
        (step_id,),
    )
    subtitles = [SubtitleSegmentResponse(**row) for row in rows]
    return {"subtitles": [s.model_dump() for s in subtitles]}
