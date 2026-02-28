"""
DINOv2 feature extraction for visual object re-identification.

Calls a local DINOv2 inference endpoint (if DINOV2_URL is set).
Saves the feature descriptor as a .npy file and returns its path.

DINOv2 features are remarkably robust to viewpoint and lighting changes,
making them ideal as "visual fingerprints" for physical object re-ID.
"""
import os
import base64
import httpx
import numpy as np
from pathlib import Path


DINOV2_URL = os.environ.get("DINOV2_URL", "")


async def extract_features(
    frame_path: str,
    bbox: list[float] | None = None,  # [x, y, w, h] normalized — crops before extraction
    output_dir: Path | None = None,
    descriptor_filename: str | None = None,
) -> str | None:
    """
    Extract DINOv2 features from a frame (optionally cropped to bbox).

    Returns path to the saved .npy descriptor file, or None if unavailable.
    """
    if not DINOV2_URL:
        print("[DINOv2] DINOV2_URL not set — feature extraction skipped")
        return None

    frame_p = Path(frame_path)
    out_dir = output_dir or frame_p.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = descriptor_filename or f"{frame_p.stem}_dinov2.npy"
    descriptor_path = out_dir / out_name

    try:
        # Optionally crop the frame to the bbox region
        if bbox is not None:
            image_bytes = _crop_frame(frame_path, bbox)
            if image_bytes is None:
                return None
        else:
            with open(frame_path, "rb") as f:
                image_bytes = f.read()

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{DINOV2_URL}/extract",
                files={"image": ("crop.jpg", image_bytes, "image/jpeg")},
            )
            resp.raise_for_status()
            data = resp.json()

        features = np.array(data["features"], dtype=np.float32)
        np.save(str(descriptor_path), features)
        return str(descriptor_path)

    except Exception as e:
        print(f"[DINOv2] Feature extraction failed: {e}")
        return None


def _crop_frame(frame_path: str, bbox: list[float]) -> bytes | None:
    """Crop a frame to the normalized bbox and return JPEG bytes."""
    try:
        import cv2
        frame = cv2.imread(frame_path)
        if frame is None:
            return None
        h, w = frame.shape[:2]
        x, y, bw, bh = bbox
        x1 = max(0, int(x * w))
        y1 = max(0, int(y * h))
        x2 = min(w, int((x + bw) * w))
        y2 = min(h, int((y + bh) * h))
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None
        _, buf = cv2.imencode(".jpg", crop)
        return buf.tobytes()
    except Exception as e:
        print(f"[DINOv2] Frame crop failed: {e}")
        return None


def cosine_similarity(a_path: str, b_path: str) -> float:
    """Compute cosine similarity between two stored DINOv2 descriptors."""
    try:
        a = np.load(a_path)
        b = np.load(b_path)
        dot = float(np.dot(a, b))
        norm = float(np.linalg.norm(a) * np.linalg.norm(b))
        return dot / norm if norm > 0 else 0.0
    except Exception:
        return 0.0
