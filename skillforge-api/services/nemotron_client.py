"""
Nemotron VL — object presence detection + spatial localization across video frames.

Calls a self-hosted Nemotron Nano 12B VL server (OpenAI-compatible vLLM)
via NEMOTRON_URL. For each frame, answers: "Is this object present?" and
if so, returns approximate center coordinates (normalized 0-1).

Used by: services/key_object_pipeline.py (multi-agent hardware pipeline).
"""
import json
import os
import asyncio
import time
import httpx
from utils.frame_utils import resize_frame_for_api

NEMOTRON_URL = os.environ.get("NEMOTRON_URL", "")
NEMOTRON_MODEL = "nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16"

_startup_logged = False
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=60.0,
            limits=httpx.Limits(max_connections=6, max_keepalive_connections=4),
        )
    return _client


async def detect_object_in_frame(
    frame_path: str,
    object_description: str,
    step_context: str | None = None,
) -> dict:
    """
    Check whether a described object is present in the given frame.

    Args:
        frame_path: Path to a JPEG frame image.
        object_description: Text describing the object to detect.
        step_context: Optional rich context (title, description, transcript)
            from the Claude Haiku refinement stage to improve detection accuracy.

    Returns:
        {
            "present": bool,
            "description": str,
            "center_x": float | None,  # normalized 0-1, only when present
            "center_y": float | None,  # normalized 0-1, only when present
        }
    """
    global _startup_logged
    nemotron_url = os.environ.get("NEMOTRON_URL", "")

    if not nemotron_url:
        if not _startup_logged:
            print("[Nemotron] ⚠ NEMOTRON_URL not set — skipping object detection", flush=True)
            _startup_logged = True
        return {"present": False, "description": "", "center_x": None, "center_y": None}

    if not _startup_logged:
        print(f"[Nemotron] Configured → {nemotron_url}", flush=True)
        _startup_logged = True

    image_b64 = resize_frame_for_api(frame_path, max_size=1024)

    context_block = ""
    if step_context:
        context_block = f"{step_context}\n\n"

    prompt = (
        f'{context_block}'
        f'Is the following object present in this image?\n'
        f'Object: {object_description}\n\n'
        f'Answer ONLY with valid JSON, no markdown:\n'
        f'{{"present": true or false, '
        f'"description": "1 sentence explaining what you see or why the object is not visible", '
        f'"center_x": 0.0 to 1.0 horizontal position of the object center (omit if not present), '
        f'"center_y": 0.0 to 1.0 vertical position of the object center (omit if not present)}}'
    )

    payload = {
        "model": NEMOTRON_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
    }

    try:
        t0 = time.perf_counter()
        client = _get_client()
        resp = await client.post(
            f"{nemotron_url}/v1/chat/completions",
            json=payload,
        )
        resp.raise_for_status()
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        content = resp.json()["choices"][0]["message"]["content"]
        result = _parse_detection_response(content)
        status = "✓ FOUND" if result["present"] else "✗ not found"
        coord_str = ""
        if result["present"] and result.get("center_x") is not None:
            coord_str = f" @ ({result['center_x']:.2f}, {result['center_y']:.2f})"
        print(f"[Nemotron] {status} in {elapsed_ms}ms{coord_str} — {result['description'][:80]}", flush=True)
        return result

    except httpx.ConnectError:
        print(f"[Nemotron] ✗ Connection refused — is the server running at {nemotron_url}?", flush=True)
        return {"present": False, "description": "", "center_x": None, "center_y": None}
    except httpx.TimeoutException:
        print("[Nemotron] ✗ Request timed out (60s limit)", flush=True)
        return {"present": False, "description": "", "center_x": None, "center_y": None}
    except Exception as e:
        print(f"[Nemotron] ✗ Detection failed: {e}", flush=True)
        return {"present": False, "description": "", "center_x": None, "center_y": None}


def _extract_coords(data: dict) -> tuple[float | None, float | None]:
    """Extract and clamp center_x/center_y from parsed JSON."""
    present = bool(data.get("present", False))
    if not present:
        return None, None
    cx = data.get("center_x")
    cy = data.get("center_y")
    if cx is not None and cy is not None:
        try:
            cx = max(0.0, min(1.0, float(cx)))
            cy = max(0.0, min(1.0, float(cy)))
            return cx, cy
        except (TypeError, ValueError):
            pass
    return None, None


def _parse_detection_response(text: str) -> dict:
    """Extract {present, description, center_x, center_y} from model response."""
    import re

    text = text.strip()

    def _build(data: dict) -> dict:
        cx, cy = _extract_coords(data)
        return {
            "present": bool(data.get("present", False)),
            "description": str(data.get("description", "")),
            "center_x": cx,
            "center_y": cy,
        }

    # Direct JSON parse
    try:
        return _build(json.loads(text))
    except json.JSONDecodeError:
        pass

    # Extract from markdown code block
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return _build(json.loads(match.group(1)))
        except json.JSONDecodeError:
            pass

    # Extract bare JSON
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return _build(json.loads(match.group(0)))
        except json.JSONDecodeError:
            pass

    # Heuristic fallback: check if response contains "true" or "yes"
    lower = text.lower()
    present = any(w in lower for w in ["true", '"present": true', "yes, "])
    return {"present": present, "description": text[:200], "center_x": None, "center_y": None}


async def detect_object_in_frames_batch(
    frame_paths: list[str],
    object_description: str,
    batch_size: int = 4,
    on_progress=None,
) -> list[dict]:
    """
    Scan multiple frames for the presence of a described object.
    Returns list of {frame_path, present, description, center_x, center_y}
    in the same order.
    """
    results = []
    total = len(frame_paths)

    for i in range(0, total, batch_size):
        batch = frame_paths[i : i + batch_size]
        tasks = [detect_object_in_frame(fp, object_description) for fp in batch]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        for fp, result in zip(batch, batch_results):
            if isinstance(result, Exception):
                print(f"[Nemotron] ✗ Batch detection error: {result}", flush=True)
                result = {"present": False, "description": f"Error: {result}", "center_x": None, "center_y": None}
            results.append({"frame_path": fp, **result})

        done = min(i + batch_size, total)
        if on_progress:
            await on_progress(f"Nemotron: scanned {done}/{total} frames", done, total)

    positive = sum(1 for r in results if r["present"])
    print(f"[Nemotron] Scan complete: {positive}/{total} frames contain the object", flush=True)
    return results


NEMOTRON_MAX_CONCURRENT = 6


async def detect_objects_in_frames_parallel(
    objects_with_frames: list[tuple[str, str, list[str]]],
    max_concurrent: int = NEMOTRON_MAX_CONCURRENT,
    step_context: str | None = None,
) -> dict[str, list[dict]]:
    """
    Scan multiple objects across frames in parallel, sharing a single
    concurrency semaphore so the GPU stays saturated without being overwhelmed.

    Args:
        objects_with_frames: List of (label, object_description, frame_paths) tuples.
        max_concurrent: Max simultaneous Nemotron requests (matches httpx connection limit).
        step_context: Optional rich context (title, description, transcript)
            prepended to each detection prompt.

    Returns:
        {label: [{frame_path, present, description, center_x, center_y}, ...]}
        Per-label results are ordered the same as the input frame_paths.
    """
    _EMPTY = {"present": False, "description": "", "center_x": None, "center_y": None}
    sem = asyncio.Semaphore(max_concurrent)

    async def _gated_detect(frame_path: str, description: str) -> dict:
        async with sem:
            try:
                result = await detect_object_in_frame(frame_path, description, step_context=step_context)
            except Exception as e:
                print(f"[Nemotron] ✗ Parallel detection error: {e}", flush=True)
                result = {**_EMPTY, "description": f"Error: {e}"}
            return {"frame_path": frame_path, **result}

    flat_coros = []
    label_keys: list[str] = []

    for label, description, frame_paths in objects_with_frames:
        for fp in frame_paths:
            flat_coros.append(_gated_detect(fp, description))
            label_keys.append(label)

    flat_results = await asyncio.gather(*flat_coros, return_exceptions=True)

    buckets: dict[str, list[dict]] = {label: [] for label, _, _ in objects_with_frames}
    for label, result in zip(label_keys, flat_results):
        if isinstance(result, Exception):
            print(f"[Nemotron] ✗ Parallel task error for \"{label}\": {result}", flush=True)
            result = {"frame_path": "unknown", **_EMPTY, "description": f"Error: {result}"}
        buckets[label].append(result)

    for label, detections in buckets.items():
        positive = sum(1 for d in detections if d["present"])
        print(
            f"[Nemotron] Parallel scan: \"{label}\" found in {positive}/{len(detections)} frames",
            flush=True,
        )

    return buckets
