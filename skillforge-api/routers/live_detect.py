"""
Live camera detection endpoint — runs detectors on a single raw frame
without needing a workflow or session context.

Supports: MediaPipe hands, SAM 3 concept segmentation (text prompt, remote GPU).

Hands are processed directly from bytes (no disk I/O).
SAM 3 works from bytes via the remote inference server.
"""
import base64
import time
from fastapi import APIRouter
from pydantic import BaseModel

from services.mediapipe_tracker import extract_hand_data_from_bytes
from services.sam3_service import segment_concept as sam3_segment_concept

router = APIRouter(prefix="/api/live", tags=["live-detect"])


class DetectFrameRequest(BaseModel):
    frame_base64: str
    modes: list[str] = ["hands"]   # "hands" | "sam3"
    text_prompt: str | None = None
    confidence_threshold: float = 0.35


class DetectFrameResponse(BaseModel):
    hands: dict | None = None
    sam3_segments: list[dict] = []
    processing_ms: int = 0


@router.post("/detect-frame", response_model=DetectFrameResponse)
async def detect_frame(body: DetectFrameRequest):
    """
    Run real-time detectors on a single base64-encoded JPEG frame.
    Returns combined results for all requested modes.
    """
    t0 = time.monotonic()

    frame_bytes = base64.b64decode(body.frame_base64)

    hands = None
    sam3_segments: list[dict] = []

    if "hands" in body.modes:
        hands = extract_hand_data_from_bytes(frame_bytes)

    if "sam3" in body.modes and body.text_prompt:
        result = await sam3_segment_concept(
            frame_bytes,
            body.text_prompt,
            confidence_threshold=body.confidence_threshold,
        )
        if result:
            sam3_segments = result["segments"]

    processing_ms = int((time.monotonic() - t0) * 1000)

    return DetectFrameResponse(
        hands=hands,
        sam3_segments=sam3_segments,
        processing_ms=processing_ms,
    )
