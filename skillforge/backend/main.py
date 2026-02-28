"""
AR camera stream WebSocket server + live detect-frame (MediaPipe Hands).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from contextlib import asynccontextmanager

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from mediapipe.tasks.python import vision as mp_vision
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

AR_WS_PATH = "/ws/ar"
LIVE_DETECT_WS_PATH = "/ws/live/detect"

# MediaPipe Hand Landmarker: index finger tip (landmark 8) for "pointing_at"
INDEX_FINGER_TIP = 8

# Lazy-initialized Hand Landmarker IMAGE mode (for HTTP POST)
_hand_landmarker: mp_vision.HandLandmarker | None = None
_hand_landmarker_delegate: str = "cpu"  # "cpu" | "gpu"

# Lazy-initialized Hand Landmarker VIDEO mode (for WebSocket, tracking)
_hand_landmarker_video: mp_vision.HandLandmarker | None = None
_hand_landmarker_video_delegate: str = "cpu"


def _get_hand_landmarker() -> mp_vision.HandLandmarker:
    global _hand_landmarker, _hand_landmarker_delegate
    if _hand_landmarker is None:
        model_path = os.path.join(os.path.dirname(__file__), "models", "hand_landmarker.task")
        if not os.path.isfile(model_path):
            raise FileNotFoundError(
                f"Hand landmarker model not found at {model_path}. "
                "Download from: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
            )
        delegate_env = os.environ.get("MEDIAPIPE_DELEGATE", "").strip().lower()
        try_cpu_only = delegate_env == "cpu"
        if not try_cpu_only:
            try:
                base = mp.tasks.BaseOptions(
                    model_asset_path=model_path,
                    delegate=mp.tasks.BaseOptions.Delegate.GPU,
                )
                opts = mp_vision.HandLandmarkerOptions(
                    base_options=base,
                    running_mode=mp_vision.RunningMode.IMAGE,
                    num_hands=2,
                )
                _hand_landmarker = mp_vision.HandLandmarker.create_from_options(opts)
                _hand_landmarker_delegate = "gpu"
                print("[Hand Landmarker] Using GPU delegate for faster detection.", flush=True)
            except Exception as e:
                if delegate_env == "gpu":
                    raise RuntimeError(f"MEDIAPIPE_DELEGATE=gpu requested but GPU init failed: {e}") from e
                _hand_landmarker = None
        if _hand_landmarker is None:
            base = mp.tasks.BaseOptions(
                model_asset_path=model_path,
                delegate=mp.tasks.BaseOptions.Delegate.CPU,
            )
            opts = mp_vision.HandLandmarkerOptions(
                base_options=base,
                running_mode=mp_vision.RunningMode.IMAGE,
                num_hands=2,
            )
            _hand_landmarker = mp_vision.HandLandmarker.create_from_options(opts)
            _hand_landmarker_delegate = "cpu"
            print("[Hand Landmarker] Using CPU delegate.", flush=True)
    return _hand_landmarker


def _get_hand_landmarker_video() -> mp_vision.HandLandmarker:
    """Hand Landmarker in VIDEO mode for WebSocket (tracking across frames)."""
    global _hand_landmarker_video, _hand_landmarker_video_delegate
    if _hand_landmarker_video is None:
        model_path = os.path.join(os.path.dirname(__file__), "models", "hand_landmarker.task")
        if not os.path.isfile(model_path):
            raise FileNotFoundError(
                f"Hand landmarker model not found at {model_path}. "
                "Download from: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
            )
        delegate_env = os.environ.get("MEDIAPIPE_DELEGATE", "").strip().lower()
        try_cpu_only = delegate_env == "cpu"
        if not try_cpu_only:
            try:
                base = mp.tasks.BaseOptions(
                    model_asset_path=model_path,
                    delegate=mp.tasks.BaseOptions.Delegate.GPU,
                )
                opts = mp_vision.HandLandmarkerOptions(
                    base_options=base,
                    running_mode=mp_vision.RunningMode.VIDEO,
                    num_hands=2,
                )
                _hand_landmarker_video = mp_vision.HandLandmarker.create_from_options(opts)
                _hand_landmarker_video_delegate = "gpu"
                print("[Hand Landmarker VIDEO] Using GPU delegate.", flush=True)
            except Exception as e:
                if delegate_env == "gpu":
                    raise RuntimeError(f"MEDIAPIPE_DELEGATE=gpu requested but GPU init failed: {e}") from e
                _hand_landmarker_video = None
        if _hand_landmarker_video is None:
            base = mp.tasks.BaseOptions(
                model_asset_path=model_path,
                delegate=mp.tasks.BaseOptions.Delegate.CPU,
            )
            opts = mp_vision.HandLandmarkerOptions(
                base_options=base,
                running_mode=mp_vision.RunningMode.VIDEO,
                num_hands=2,
            )
            _hand_landmarker_video = mp_vision.HandLandmarker.create_from_options(opts)
            _hand_landmarker_video_delegate = "cpu"
            print("[Hand Landmarker VIDEO] Using CPU delegate.", flush=True)
    return _hand_landmarker_video


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="AR Pose Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def decode_frame(data: str) -> np.ndarray | None:
    """Decode base64 JPEG to OpenCV BGR image."""
    try:
        raw = base64.b64decode(data)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None


# ─── Live detect-frame (MediaPipe Hands) ──────────────────────────────────────

class DetectFrameRequest(BaseModel):
    frame_base64: str
    modes: list[str]
    text_prompt: str | None = None
    confidence_threshold: float = 0.35


def run_hand_detection(img_bgr: np.ndarray, min_confidence: float = 0.5) -> tuple[list[list[dict]], dict | None]:
    """
    Run MediaPipe Hand Landmarker on BGR image.
    Returns (list of hands with landmarks in 0–100 scale, pointing_at from first hand's index tip or None).
    """
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    detector = _get_hand_landmarker()
    result = detector.detect(mp_image)

    hands_out: list[list[dict]] = []
    pointing_at: dict | None = None

    if not result.hand_landmarks:
        return hands_out, pointing_at

    for hand in result.hand_landmarks:
        landmarks = [
            {"x": round(lm.x * 100, 2), "y": round(lm.y * 100, 2)}
            for lm in hand
        ]
        hands_out.append(landmarks)
        if pointing_at is None and len(hand) > INDEX_FINGER_TIP:
            tip = hand[INDEX_FINGER_TIP]
            pointing_at = {"x": round(tip.x * 100, 2), "y": round(tip.y * 100, 2)}

    return hands_out, pointing_at


def run_hand_detection_video(img_bgr: np.ndarray, timestamp_ms: int) -> tuple[list[list[dict]], dict | None]:
    """
    Run MediaPipe Hand Landmarker in VIDEO mode (tracking).
    Returns (list of hands with landmarks in 0–100 scale, pointing_at from first hand's index tip or None).
    """
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    detector = _get_hand_landmarker_video()
    result = detector.detect_for_video(mp_image, timestamp_ms)

    hands_out: list[list[dict]] = []
    pointing_at: dict | None = None

    if not result.hand_landmarks:
        return hands_out, pointing_at

    for hand in result.hand_landmarks:
        landmarks = [
            {"x": round(lm.x * 100, 2), "y": round(lm.y * 100, 2)}
            for lm in hand
        ]
        hands_out.append(landmarks)
        if pointing_at is None and len(hand) > INDEX_FINGER_TIP:
            tip = hand[INDEX_FINGER_TIP]
            pointing_at = {"x": round(tip.x * 100, 2), "y": round(tip.y * 100, 2)}

    return hands_out, pointing_at


def _build_detect_response(
    hands_list: list[list[dict]],
    pointing_at: dict | None,
    elapsed_ms: float,
    sam3_segments: list[dict] | None = None,
) -> dict:
    """Build DetectionResult-shaped dict for frontend."""
    hands_data = None
    if hands_list:
        hands_data = {
            "hand_count": len(hands_list),
            "hands": [{"landmarks": lm} for lm in hands_list],
            "pointing_at": pointing_at,
        }
    return {
        "hands": hands_data,
        "sam3_segments": sam3_segments or [],
        "processing_ms": round(elapsed_ms, 0),
    }


@app.post("/api/live/detect-frame")
def api_detect_frame(body: DetectFrameRequest):
    """Live detection: hands (MediaPipe), yolo/custom stubbed. Response matches frontend DetectionResult."""
    t0 = time.perf_counter()
    img = decode_frame(body.frame_base64)
    if img is None:
        return _build_detect_response([], None, 0)

    hands_list: list[list[dict]] = []
    pointing_at = None
    if "hands" in body.modes:
        hands_list, pointing_at = run_hand_detection(img, min_confidence=body.confidence_threshold)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    return _build_detect_response(hands_list, pointing_at, elapsed_ms)


def identity_4x4() -> list[float]:
    """4x4 identity matrix as row-major list (for placeholder pose)."""
    return [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]


@app.websocket(LIVE_DETECT_WS_PATH)
async def websocket_live_detect(websocket: WebSocket):
    """Live hand detection over WebSocket (VIDEO mode, process latest only)."""
    await websocket.accept()
    processing = False
    pending_data: str | None = None
    pending_ts: int | None = None

    async def process_one(data_str: str, timestamp_ms: int) -> None:
        nonlocal processing, pending_data, pending_ts
        processing = True
        try:
            img = decode_frame(data_str)
            if img is None:
                await websocket.send_json({"type": "error", "message": "decode failed"})
                return
            t0 = time.perf_counter()
            hands_list, pointing_at = await asyncio.to_thread(run_hand_detection_video, img, timestamp_ms)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            await websocket.send_json(_build_detect_response(hands_list, pointing_at, elapsed_ms))
        except Exception as e:
            await websocket.send_json({"type": "error", "message": str(e)})
        finally:
            processing = False
            if pending_data is not None and pending_ts is not None:
                d, t = pending_data, pending_ts
                pending_data, pending_ts = None, None
                asyncio.create_task(process_one(d, t))

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "invalid json"})
                continue
            if msg.get("type") != "frame":
                await websocket.send_json({"type": "error", "message": "expected type: frame"})
                continue
            data = msg.get("data")
            ts = msg.get("timestamp_ms")
            if not isinstance(data, str):
                await websocket.send_json({"type": "error", "message": "missing or invalid data"})
                continue
            if not isinstance(ts, (int, float)):
                await websocket.send_json({"type": "error", "message": "missing or invalid timestamp_ms"})
                continue
            timestamp_ms = int(ts)
            if processing:
                pending_data, pending_ts = data, timestamp_ms
            else:
                asyncio.create_task(process_one(data, timestamp_ms))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


@app.websocket(AR_WS_PATH)
async def websocket_ar(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "invalid json"})
                continue
            if msg.get("type") != "frame":
                await websocket.send_json({"type": "error", "message": "expected type: frame"})
                continue
            data = msg.get("data")
            if not isinstance(data, str):
                await websocket.send_json({"type": "error", "message": "missing or invalid data"})
                continue
            img = decode_frame(data)
            if img is None:
                await websocket.send_json({"type": "error", "message": "decode failed"})
                continue
            # Placeholder: ack + identity pose so round-trip works. Replace with real PnP/ArUco later.
            await websocket.send_json({
                "type": "pose",
                "view_matrix": identity_4x4(),
                "projection_matrix": identity_4x4(),
            })
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
