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
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
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


# ── Crop-and-zoom segmentation for small objects ──────────────────────────────

_SMALL_OBJ_CROP_RADIUS = 0.10  # 10% of image → 20% window (tighter zoom)


async def segment_small_object(
    frame_bytes: bytes,
    center_x: float,
    center_y: float,
    text_prompt: str,
    crop_radius: float = _SMALL_OBJ_CROP_RADIUS,
    confidence_threshold: float = 0.10,
) -> dict | None:
    """
    Segment a small object by cropping around its approximate center,
    running SAM3 on the zoomed crop, then remapping results back to
    full-frame coordinates.

    Two-phase approach on the crop:
      1. Text-prompt (the object is now prominent in the zoomed view)
      2. Box-prompt at the center of the crop (if text fails)

    Args:
        center_x, center_y: Normalized (0-1) center of the object (from Nemotron).
        text_prompt: SAM3 text prompt for the object.
        crop_radius: Half-size of crop window in normalized coords.

    Returns same shape as segment_concept with coordinates in full-frame space,
    plus a full-frame-sized mask, or None.
    """
    if not SAM3_URL:
        return None

    try:
        img = Image.open(io.BytesIO(frame_bytes))
        w, h = img.size

        cx_px, cy_px = center_x * w, center_y * h
        r_px_w, r_px_h = crop_radius * w, crop_radius * h
        crop_x1 = max(0, int(cx_px - r_px_w))
        crop_y1 = max(0, int(cy_px - r_px_h))
        crop_x2 = min(w, int(cx_px + r_px_w))
        crop_y2 = min(h, int(cy_px + r_px_h))

        if crop_x2 - crop_x1 < 32 or crop_y2 - crop_y1 < 32:
            print(f"[SAM3] ✗ Crop too small ({crop_x2-crop_x1}x{crop_y2-crop_y1}px) — skipping", flush=True)
            return None

        crop = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
        crop_buf = io.BytesIO()
        crop.save(crop_buf, format="JPEG", quality=95)
        crop_bytes = crop_buf.getvalue()
        crop_w, crop_h = crop.size

        print(
            f"[SAM3] Crop-zoom: {crop_w}x{crop_h}px from ({crop_x1},{crop_y1}) "
            f"to ({crop_x2},{crop_y2}) of {w}x{h} frame",
            flush=True,
        )

        client = _get_client()

        # ── Phase 1: text-prompt on the crop ──
        t0 = time.perf_counter()
        resp = await client.post(
            f"{SAM3_URL}/segment",
            files={"image": ("crop.jpg", crop_bytes, "image/jpeg")},
            data={"text": text_prompt},
        )
        resp.raise_for_status()
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        data = resp.json()
        results = _remap_crop_results(
            data, crop_x1, crop_y1, crop_w, crop_h, w, h, confidence_threshold,
        )

        if results:
            scores_str = ", ".join(f"{r['score']:.0%}" for r in results)
            print(
                f"[SAM3] ✓ Crop text \"{text_prompt}\" — "
                f"{len(results)} mask(s) [{scores_str}] in {elapsed_ms}ms",
                flush=True,
            )
            return {"segments": results}

        # ── Phase 2: box-prompt at center of crop (object should be right there) ──
        print(
            f"[SAM3] Crop text miss for \"{text_prompt}\" — trying box-prompt on crop center",
            flush=True,
        )
        box_margin = 0.15
        box_str = f"{box_margin},{box_margin},{1.0-box_margin},{1.0-box_margin}"

        t0 = time.perf_counter()
        resp = await client.post(
            f"{SAM3_URL}/segment",
            files={"image": ("crop.jpg", crop_bytes, "image/jpeg")},
            data={"box": box_str},
        )
        resp.raise_for_status()
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        data = resp.json()
        results = _remap_crop_results(
            data, crop_x1, crop_y1, crop_w, crop_h, w, h, confidence_threshold,
        )

        if results:
            scores_str = ", ".join(f"{r['score']:.0%}" for r in results)
            print(
                f"[SAM3] ✓ Crop box-prompt — "
                f"{len(results)} mask(s) [{scores_str}] in {elapsed_ms}ms",
                flush=True,
            )
            return {"segments": results}

        print(f"[SAM3] ✗ Crop-zoom: both text and box failed for \"{text_prompt}\"", flush=True)
        return None

    except httpx.ConnectError:
        print(f"[SAM3] ✗ Connection refused — is the server running at {SAM3_URL}?", flush=True)
        return None
    except httpx.TimeoutException:
        print(f"[SAM3] ✗ Small-object crop timed out (30s limit)", flush=True)
        return None
    except Exception as e:
        print(f"[SAM3] ✗ Small-object crop failed: {e}", flush=True)
        return None


def _remap_crop_results(
    data: dict,
    crop_x1: int, crop_y1: int,
    crop_w: int, crop_h: int,
    full_w: int, full_h: int,
    confidence_threshold: float,
) -> list[dict]:
    """Remap SAM3 results from crop coordinates to full-frame coordinates."""
    if "error" in data:
        return []

    results = []
    for mask_b64, box, score in zip(
        data.get("masks", []),
        data.get("boxes", []),
        data.get("scores", []),
    ):
        if score < confidence_threshold:
            continue

        box_full = [
            (crop_x1 + box[0] * crop_w) / full_w,
            (crop_y1 + box[1] * crop_h) / full_h,
            (crop_x1 + box[2] * crop_w) / full_w,
            (crop_y1 + box[3] * crop_h) / full_h,
        ]

        mask_bytes_raw = base64.b64decode(mask_b64)
        crop_mask = Image.open(io.BytesIO(mask_bytes_raw)).convert("L").resize((crop_w, crop_h))
        full_mask = Image.new("L", (full_w, full_h), 0)
        full_mask.paste(crop_mask, (crop_x1, crop_y1))
        mask_buf = io.BytesIO()
        full_mask.save(mask_buf, format="PNG")
        full_mask_b64 = base64.b64encode(mask_buf.getvalue()).decode()

        results.append({
            "mask_base64": full_mask_b64,
            "bbox": box_full,
            "score": score,
        })

    return results


# ── Synthetic point-highlight for tiny objects SAM3 can't segment ─────────────

_POINT_HIGHLIGHT_RADIUS_FRAC = 0.025  # 2.5% of frame → ~32px circle on 1280px


def generate_point_highlight(
    frame_bytes: bytes,
    center_x: float,
    center_y: float,
    radius_frac: float = _POINT_HIGHLIGHT_RADIUS_FRAC,
) -> dict:
    """
    Create a synthetic circular mask at known coordinates for objects too
    small for SAM3 to segment (individual pins, SMD components, etc.).

    Returns a segment dict with mask_base64, bbox, and score=1.0 (coordinates
    are trusted from Nemotron, not from SAM3 inference).
    """
    img = Image.open(io.BytesIO(frame_bytes))
    w, h = img.size

    cx_px = center_x * w
    cy_px = center_y * h
    r_px = radius_frac * max(w, h)

    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse(
        [cx_px - r_px, cy_px - r_px, cx_px + r_px, cy_px + r_px],
        fill=255,
    )

    mask_buf = io.BytesIO()
    mask.save(mask_buf, format="PNG")
    mask_b64 = base64.b64encode(mask_buf.getvalue()).decode()

    bbox_r = radius_frac * 1.2
    bbox = [
        max(0.0, center_x - bbox_r),
        max(0.0, center_y - bbox_r),
        min(1.0, center_x + bbox_r),
        min(1.0, center_y + bbox_r),
    ]

    print(
        f"[SAM3] Point-highlight at ({center_x:.2f}, {center_y:.2f}) "
        f"— {int(r_px * 2)}px diameter on {w}x{h} frame",
        flush=True,
    )
    return {"mask_base64": mask_b64, "bbox": bbox, "score": 1.0}


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
