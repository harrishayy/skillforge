"""
Trainee learning endpoints — suggest step completion from camera frame.
Uses SAM3 + MediaPipe to suggest when the trainee has completed the current step;
user must confirm via voice/button/gesture (suggest-then-confirm).
"""
import base64
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models.database import fetchone
from services.mediapipe_tracker import extract_hand_data_from_bytes
from services.sam3_service import segment_concept as sam3_segment_concept

router = APIRouter(prefix="/api/trainee", tags=["trainee"])

# Suggest complete when SAM3 segment score >= this
SUGGEST_SAM3_CONFIDENCE = 0.35
# Hand "near" object: index tip within this normalized distance of bbox center, or inside expanded bbox
HAND_NEAR_BBOX_EXPAND = 0.12
HAND_NEAR_CENTER_DIST = 0.25


class CheckStepSuggestRequest(BaseModel):
    workflow_id: str
    step_id: str
    frame_base64: str


class CheckStepSuggestResponse(BaseModel):
    suggest_complete: bool
    message: str
    hands: dict | None = None
    sam3_segments: list[dict] = []


def _hand_near_segment(hands: dict | None, bbox: list[float]) -> bool:
    """True if any hand's index tip (landmark 8) is near the segment bbox (normalized 0-1)."""
    if not hands or not hands.get("hands") or len(bbox) < 4:
        return False
    x1, y1, x2, y2 = bbox[0], bbox[1], bbox[2], bbox[3]
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    # Expand bbox slightly for "near"
    ex = HAND_NEAR_BBOX_EXPAND
    bx1, by1 = max(0, x1 - ex), max(0, y1 - ex)
    bx2, by2 = min(1, x2 + ex), min(1, y2 + ex)

    for hand in hands["hands"]:
        landmarks = hand.get("landmarks", [])
        if len(landmarks) <= 8:
            continue
        # Index tip = landmark 8; coords are 0-100 from mediapipe_tracker
        tip = landmarks[8]
        tx = tip["x"] / 100.0
        ty = tip["y"] / 100.0
        if bx1 <= tx <= bx2 and by1 <= ty <= by2:
            return True
        dist = ((tx - cx) ** 2 + (ty - cy) ** 2) ** 0.5
        if dist <= HAND_NEAR_CENTER_DIST:
            return True
    return False


@router.post("/check-step-suggest", response_model=CheckStepSuggestResponse)
async def check_step_suggest(body: CheckStepSuggestRequest):
    """
    Run SAM3 + MediaPipe on a trainee camera frame; suggest "complete" when
    the step's key object is detected and optionally hand is near it.
    Idempotent; no side effects.
    """
    step = await fetchone("SELECT id, sam3_prompt FROM steps WHERE id=? AND workflow_id=?", (body.step_id, body.workflow_id))
    if not step:
        raise HTTPException(404, "Step not found")

    sam3_prompt = (step.get("sam3_prompt") or "").strip()
    if not sam3_prompt:
        return CheckStepSuggestResponse(
            suggest_complete=False,
            message="No detection target for this step.",
            hands=None,
            sam3_segments=[],
        )

    try:
        frame_bytes = base64.b64decode(body.frame_base64)
    except Exception as e:
        raise HTTPException(400, f"Invalid frame_base64: {e}") from e

    # Run SAM3 and MediaPipe (same as live_detect)
    sam3_result = await sam3_segment_concept(
        frame_bytes,
        sam3_prompt,
        confidence_threshold=SUGGEST_SAM3_CONFIDENCE,
    )
    hands = extract_hand_data_from_bytes(frame_bytes)

    segments = (sam3_result.get("segments") or []) if sam3_result else []

    if not segments:
        return CheckStepSuggestResponse(
            suggest_complete=False,
            message="Object not clearly visible. Try moving the object into view.",
            hands=hands,
            sam3_segments=[],
        )

    # Best segment (highest score)
    best = max(segments, key=lambda s: s.get("score", 0))
    bbox = best.get("bbox", [0, 0, 0, 0])
    hand_near = _hand_near_segment(hands, bbox)

    if hand_near:
        return CheckStepSuggestResponse(
            suggest_complete=True,
            message="Object detected and hand nearby. Say 'next' or tap Continue.",
            hands=hands,
            sam3_segments=segments,
        )
    return CheckStepSuggestResponse(
        suggest_complete=True,
        message="Object detected. Say 'next' or tap Continue to advance.",
        hands=hands,
        sam3_segments=segments,
    )
