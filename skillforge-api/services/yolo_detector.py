import asyncio
import cv2
import numpy as np

_model = None


def load_model():
    """Load YOLO model once at startup. Falls back gracefully if unavailable."""
    global _model
    try:
        from ultralytics import YOLO
        _model = YOLO("yolov8n.pt")
        print("[YOLO] Model loaded: yolov8n.pt")
    except Exception as e:
        print(f"[YOLO] Could not load model: {e}. UI detection will be skipped.")
        _model = None


def detect_from_bytes(frame_bytes: bytes) -> list[dict]:
    """Detect objects in raw JPEG bytes (avoids disk I/O)."""
    if _model is None:
        return []
    try:
        arr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return []
        return _run_inference(frame)
    except Exception as e:
        print(f"[YOLO] Detection error: {e}")
        return []


def detect_ui_elements_sync(frame_path: str) -> list[dict]:
    """Detect objects in a frame file path."""
    if _model is None:
        return []
    try:
        results = _model(frame_path, conf=0.35, verbose=False)
        detections = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = r.names[cls_id]
                cx, cy, bw, bh = box.xywhn[0].tolist()
                detections.append({
                    "class": cls_name,
                    "confidence": float(box.conf[0]),
                    "bbox_x": (cx - bw / 2) * 100,
                    "bbox_y": (cy - bh / 2) * 100,
                    "bbox_width": bw * 100,
                    "bbox_height": bh * 100,
                })
        return detections
    except Exception as e:
        print(f"[YOLO] Detection error: {e}")
        return []


def _run_inference(frame) -> list[dict]:
    """Shared inference logic for both path and bytes variants."""
    results = _model(frame, conf=0.35, verbose=False)
    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = r.names[cls_id]
            cx, cy, bw, bh = box.xywhn[0].tolist()
            detections.append({
                "class": cls_name,
                "confidence": float(box.conf[0]),
                "bbox_x": (cx - bw / 2) * 100,
                "bbox_y": (cy - bh / 2) * 100,
                "bbox_width": bw * 100,
                "bbox_height": bh * 100,
            })
    return detections


async def detect_ui_elements(frame_path: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, detect_ui_elements_sync, frame_path)
