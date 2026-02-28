"""
SAM 3 concept segmentation service.

Calls a remote SAM 3 inference server (if SAM3_URL is set) to segment
objects matching a text concept prompt. Designed for the live detection
pipeline — accepts raw frame bytes, returns masks + boxes + scores.
"""

import os
import time
import httpx


SAM3_URL = os.environ.get("SAM3_URL", "")

_startup_logged = False
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        )
    return _client


async def segment_concept(
    frame_bytes: bytes,
    text_prompt: str,
    confidence_threshold: float = 0.5,
) -> dict | None:
    """
    Segment all instances of a text concept in a JPEG frame via SAM 3.

    Returns:
        {
          "segments": [
            { "mask_base64": str, "bbox": [x1,y1,x2,y2], "score": float },
            ...
          ]
        }
        or None if SAM3_URL is not set / request fails / nothing found.
    """
    global _startup_logged
    if not SAM3_URL:
        if not _startup_logged:
            print("[SAM3] ⚠ SAM3_URL not set — skipping segmentation", flush=True)
            _startup_logged = True
        return None

    if not _startup_logged:
        print(f"[SAM3] Configured → {SAM3_URL}", flush=True)
        _startup_logged = True

    try:
        t0 = time.perf_counter()
        client = _get_client()
        resp = await client.post(
            f"{SAM3_URL}/segment",
            files={"image": ("frame.jpg", frame_bytes, "image/jpeg")},
            data={"text": text_prompt},
        )
        resp.raise_for_status()
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        data = resp.json()
        if "error" in data:
            print(f"[SAM3] ✗ Server error: {data['error']}", flush=True)
            return None

        results = []
        for mask_b64, box, score in zip(
            data.get("masks", []),
            data.get("boxes", []),
            data.get("scores", []),
        ):
            if score >= confidence_threshold:
                results.append({
                    "mask_base64": mask_b64,
                    "bbox": box,
                    "score": score,
                })

        if results:
            scores_str = ", ".join(f"{r['score']:.0%}" for r in results)
            print(f"[SAM3] ✓ Detected \"{text_prompt}\" — {len(results)} object(s) [{scores_str}] in {elapsed_ms}ms", flush=True)

        return {"segments": results} if results else None

    except httpx.ConnectError:
        print(f"[SAM3] ✗ Connection refused — is the server running at {SAM3_URL}?", flush=True)
        return None
    except httpx.TimeoutException:
        print(f"[SAM3] ✗ Request timed out (30s limit)", flush=True)
        return None
    except Exception as e:
        print(f"[SAM3] ✗ Segmentation failed: {e}", flush=True)
        return None


async def segment_point(
    frame_bytes: bytes,
    x: float,
    y: float,
    radius: float = 0.05,
) -> dict | None:
    """
    Segment the object at a specific point by creating a small bounding box
    around (x, y) and delegating to segment_box.

    Args:
        x, y: Normalized coordinates (0-1) of the click point.
        radius: Half-size of the bounding box in normalized coords.
    """
    x1 = max(0.0, x - radius)
    y1 = max(0.0, y - radius)
    x2 = min(1.0, x + radius)
    y2 = min(1.0, y + radius)
    return await segment_box(frame_bytes, [x1, y1, x2, y2])


async def segment_box(
    frame_bytes: bytes,
    bbox: list[float],
) -> dict | None:
    """
    Segment an object at a specific bounding box using SAM 3.

    Args:
        bbox: Normalized [x1, y1, x2, y2] coordinates (0-1).

    Returns same shape as segment_concept, or None.
    """
    if not SAM3_URL:
        return None

    try:
        box_str = ",".join(str(v) for v in bbox)

        client = _get_client()
        resp = await client.post(
            f"{SAM3_URL}/segment",
            files={"image": ("frame.jpg", frame_bytes, "image/jpeg")},
            data={"box": box_str},
        )
        resp.raise_for_status()

        data = resp.json()
        if "error" in data:
            return None

        results = []
        for mask_b64, box, score in zip(
            data.get("masks", []),
            data.get("boxes", []),
            data.get("scores", []),
        ):
            results.append({
                "mask_base64": mask_b64,
                "bbox": box,
                "score": score,
            })

        return {"segments": results} if results else None

    except Exception as e:
        print(f"[SAM3] Box segmentation failed: {e}")
        return None
