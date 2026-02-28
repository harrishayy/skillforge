"""
Live camera detection endpoint — runs detectors on a single raw frame
without needing a workflow or session context.

Supports: MediaPipe hands, YOLO objects, Grounding DINO (text prompt).

Hands and YOLO are processed directly from bytes (no temp file).
Grounding DINO requires a temp file since it calls an external HTTP service.
"""
import base64
import tempfile
import time
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel

from services.mediapipe_tracker import extract_hand_data_from_bytes
from services.yolo_detector import detect_from_bytes
from services.grounding_dino_service import detect_object

router = APIRouter(prefix="/api/live", tags=["live-detect"])


class DetectFrameRequest(BaseModel):
    frame_base64: str
    modes: list[str] = ["hands"]   # "hands" | "yolo" | "custom"
    text_prompt: str | None = None
    confidence_threshold: float = 0.35


class DetectFrameResponse(BaseModel):
    hands: dict | None = None
    yolo_detections: list[dict] = []
    custom_detection: dict | None = None
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
    yolo_detections: list[dict] = []
    custom_detection = None

    # Hands and YOLO work directly from bytes — no disk I/O needed
    if "hands" in body.modes:
        hands = extract_hand_data_from_bytes(frame_bytes)

    if "yolo" in body.modes:
        yolo_detections = detect_from_bytes(frame_bytes)

    # Custom prompt (Grounding DINO / Claude) requires a file path
    if "custom" in body.modes and body.text_prompt:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp.write(frame_bytes)
            tmp_path = tmp.name
        try:
            custom_detection = await detect_object(
                tmp_path,
                body.text_prompt,
                confidence_threshold=body.confidence_threshold,
            )
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    processing_ms = int((time.monotonic() - t0) * 1000)

    return DetectFrameResponse(
        hands=hands,
        yolo_detections=yolo_detections,
        custom_detection=custom_detection,
        processing_ms=processing_ms,
    )
