"""
SAM 3 concept segmentation service.

Calls a remote SAM 3 inference server (if SAM3_URL is set) to segment
objects matching a text concept prompt.  Supports:
  - Text-prompted concept segmentation (live detection + pipeline)
  - Multi-concept segmentation (N SAM3 calls merged with per-object labels)
  - Point-prompted segmentation (click-to-segment in editor)
  - Context-driven auto-segmentation (pipeline: title/description/transcript → prompt)
  - Toggle (add/remove) segmentation for interactive refinement
"""

import io
import os
import re
import time
import base64
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont


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
    confidence_threshold: float = 0.15,
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


_POINT_BOX_RADIUS = 0.05  # half-width of the box generated around a point click


async def segment_point(
    frame_bytes: bytes,
    x: float,
    y: float,
    label: int = 1,
    box_radius: float = _POINT_BOX_RADIUS,
) -> dict | None:
    """
    Segment the object at a specific click coordinate by generating a small
    bounding box around the point and delegating to the box-prompt endpoint.

    Args:
        x, y: Normalized coordinates (0-1) of the click point.
        label: 1 = foreground (segment the object here), 0 = background (exclude).
        box_radius: Half-size of the box in normalized coords (default 5%).
    """
    if not SAM3_URL:
        return None

    bbox = [
        max(0.0, x - box_radius),
        max(0.0, y - box_radius),
        min(1.0, x + box_radius),
        min(1.0, y + box_radius),
    ]

    try:
        t0 = time.perf_counter()
        box_str = ",".join(f"{v:.4f}" for v in bbox)

        client = _get_client()
        resp = await client.post(
            f"{SAM3_URL}/segment",
            files={"image": ("frame.jpg", frame_bytes, "image/jpeg")},
            data={"box": box_str},
        )
        resp.raise_for_status()
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        data = resp.json()
        if "error" in data:
            print(f"[SAM3] ✗ Point segmentation error: {data['error']}", flush=True)
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

        if results:
            print(f"[SAM3] ✓ Point ({x:.2f}, {y:.2f}) — {len(results)} mask(s) in {elapsed_ms}ms", flush=True)

        return {"segments": results} if results else None

    except httpx.ConnectError:
        print(f"[SAM3] ✗ Connection refused — is the server running at {SAM3_URL}?", flush=True)
        return None
    except httpx.TimeoutException:
        print(f"[SAM3] ✗ Point segmentation timed out (30s limit)", flush=True)
        return None
    except Exception as e:
        print(f"[SAM3] ✗ Point segmentation failed: {e}", flush=True)
        return None


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


# ── Multi-concept segmentation ────────────────────────────────────────────────

async def segment_multi_concept(
    frame_bytes: bytes,
    prompts: list[dict],
    confidence_threshold: float = 0.15,
) -> dict:
    """
    Segment multiple distinct objects in one frame by calling segment_concept()
    once per prompt and merging the results with per-object labels and roles.

    Args:
        prompts: List of dicts, each with:
            - "label": human-readable name (e.g., "red wire")
            - "sam3_prompt": visually descriptive prompt for SAM3
            - "role": "primary" | "context" | "warning"

    Returns:
        {
            "segments": [
                {"mask_base64": str, "bbox": [...], "score": float,
                 "label": str, "role": str},
                ...
            ]
        }
    """
    all_segments = []

    for prompt_info in prompts:
        label = prompt_info.get("label", "")
        sam3_prompt = prompt_info.get("sam3_prompt", label)
        role = prompt_info.get("role", "primary")

        result = await segment_concept(frame_bytes, sam3_prompt, confidence_threshold)
        if result and result.get("segments"):
            for seg in result["segments"]:
                seg["label"] = label
                seg["role"] = role
                all_segments.append(seg)

    if all_segments:
        labels_str = ", ".join(
            f"\"{s['label']}\" ({s['role']}, {s['score']:.0%})" for s in all_segments
        )
        print(f"[SAM3] Multi-concept: {len(all_segments)} segments — {labels_str}", flush=True)

    return {"segments": all_segments}


# ── Pre-rendered segmented image generation ──────────────────────────────────

_ROLE_COLORS = {
    "primary": (16, 185, 129),   # green  #10B981
    "context": (59, 130, 246),   # blue   #3B82F6
    "warning": (239, 68, 68),    # red    #EF4444
}
_FALLBACK_COLORS = [
    (0, 255, 128),    # green
    (0, 200, 255),    # cyan
    (255, 100, 255),  # magenta
    (255, 200, 0),    # yellow
    (255, 80, 80),    # coral-red
    (100, 140, 255),  # periwinkle
    (232, 121, 249),  # orchid
    (52, 211, 153),   # mint
]
_OVERLAY_ALPHA_PRIMARY = 140   # ~55%
_OVERLAY_ALPHA_CONTEXT = 100   # ~40%


def generate_segmented_image(
    frame_path: str,
    segments: list[dict],
    output_path: str,
    label: str = "",
) -> str | None:
    """
    Composite SAM3 mask overlays onto an original frame and save as JPEG.

    Each segment dict must have 'mask_base64' (base64-encoded PNG mask),
    'bbox' [x1, y1, x2, y2] (normalised 0-1), and 'score' (float).

    Segments may also include 'label' (per-segment label) and 'role'
    ("primary" | "context" | "warning") for role-based color coding.
    If per-segment labels are present they override the shared `label` param.

    Returns the output_path on success, or None on failure.
    """
    try:
        frame = Image.open(frame_path).convert("RGBA")
        w, h = frame.size

        for i, seg in enumerate(segments):
            mask_b64 = seg.get("mask_base64")
            bbox = seg.get("bbox", [0, 0, 0, 0])
            score = seg.get("score", 0)
            if not mask_b64:
                continue

            seg_label = seg.get("label", label)
            role = seg.get("role", "primary")
            color = _ROLE_COLORS.get(role, _FALLBACK_COLORS[i % len(_FALLBACK_COLORS)])
            overlay_alpha = _OVERLAY_ALPHA_PRIMARY if role == "primary" else _OVERLAY_ALPHA_CONTEXT

            mask_bytes = base64.b64decode(mask_b64)
            mask_img = Image.open(io.BytesIO(mask_bytes)).convert("L").resize((w, h))

            color_layer = Image.new("RGBA", (w, h), (*color, 0))
            alpha = mask_img.point(lambda p, oa=overlay_alpha: min(p, oa) if p > 20 else 0)
            color_layer.putalpha(alpha)
            frame = Image.alpha_composite(frame, color_layer)

            draw = ImageDraw.Draw(frame)
            bx1 = int(bbox[0] * w)
            by1 = int(bbox[1] * h)
            bx2 = int(bbox[2] * w)
            by2 = int(bbox[3] * h)
            line_width = 3 if role == "primary" else 2
            draw.rectangle([bx1, by1, bx2, by2], outline=(*color, 220), width=line_width)

            txt = ""
            if seg_label and score:
                txt = f"{seg_label} {score:.0%}"
            elif seg_label:
                txt = seg_label
            elif score:
                txt = f"{score:.0%}"

            if txt:
                try:
                    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
                except OSError:
                    font = ImageFont.load_default()
                tbbox = draw.textbbox((0, 0), txt, font=font)
                tw, th = tbbox[2] - tbbox[0], tbbox[3] - tbbox[1]
                label_y = max(by1 - th - 6, 0)
                draw.rectangle([bx1, label_y, bx1 + tw + 8, label_y + th + 4], fill=(*color, 200))
                draw.text((bx1 + 4, label_y + 2), txt, fill=(255, 255, 255, 255), font=font)

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        rgb = frame.convert("RGB")
        rgb.save(output_path, "JPEG", quality=92)
        print(f"[SAM3] Saved segmented image → {output_path}", flush=True)
        return output_path

    except Exception as e:
        print(f"[SAM3] Failed to generate segmented image: {e}", flush=True)
        return None


# ── Context-driven segmentation (pipeline integration) ──────────────────────

def _extract_keywords(title: str, description: str, transcript: str) -> str:
    """Build a concise SAM3 text prompt from step context."""
    combined = f"{title}. {description}. {transcript}"
    combined = re.sub(r"[^a-zA-Z0-9\s,]", " ", combined)
    words = combined.lower().split()
    stopwords = {
        "the", "a", "an", "to", "and", "or", "of", "in", "on", "at", "is",
        "it", "for", "this", "that", "with", "from", "by", "as", "be", "are",
        "was", "were", "been", "do", "does", "did", "will", "would", "should",
        "can", "could", "may", "might", "then", "than", "so", "if", "not",
        "step", "click", "press", "tap", "select", "go", "open", "close",
        "now", "next", "here", "there", "just", "also", "very", "your", "you",
        "we", "i", "my", "its", "im", "ive",
    }
    seen = set()
    keywords = []
    for w in words:
        if len(w) > 2 and w not in stopwords and w not in seen:
            seen.add(w)
            keywords.append(w)
        if len(keywords) >= 8:
            break
    return ", ".join(keywords) if keywords else "object"


async def segment_with_context(
    frame_bytes: bytes,
    title: str = "",
    description: str = "",
    transcript: str = "",
    confidence_threshold: float = 0.15,
) -> dict | None:
    """
    Auto-segment a key frame using step context as the text prompt.
    Extracts keywords from title/description/transcript and calls segment_concept.
    Returns dict with "segments" and "prompt" keys, or None.
    """
    prompt = _extract_keywords(title, description, transcript)
    print(f"[SAM3] Auto-segment prompt: \"{prompt}\"", flush=True)
    result = await segment_concept(frame_bytes, prompt, confidence_threshold)
    if result:
        result["prompt"] = prompt
    return result


async def toggle_segment(
    frame_bytes: bytes,
    x: float,
    y: float,
    existing_segments: list[dict],
) -> dict:
    """
    Interactive add/remove: if (x, y) falls inside an existing segment's bbox,
    remove it; otherwise add a new segment via point-prompted SAM3.

    Returns {"segments": [...], "removed_index": int | None}.
    """
    for i, seg in enumerate(existing_segments):
        bbox = seg.get("bbox", [])
        if len(bbox) == 4:
            bx1, by1, bx2, by2 = bbox
            if bx1 <= x <= bx2 and by1 <= y <= by2:
                remaining = [s for j, s in enumerate(existing_segments) if j != i]
                return {"segments": remaining, "removed_index": i}

    result = await segment_point(frame_bytes, x, y)
    if result and result.get("segments"):
        merged = existing_segments + result["segments"]
        return {"segments": merged, "removed_index": None}

    return {"segments": existing_segments, "removed_index": None}
