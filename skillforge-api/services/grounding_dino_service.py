"""
Open-vocabulary object detection for physical workflows.

Primary: calls a local Grounding DINO endpoint (if GROUNDING_DINO_URL is set).
Fallback: uses Claude vision API to estimate a bounding box from a text prompt.

Returns normalized bbox [x, y, w, h] in range [0, 1].
"""
import os
import base64
import json
import httpx
from pathlib import Path


GROUNDING_DINO_URL = os.environ.get("GROUNDING_DINO_URL", "")


async def detect_object(
    frame_path: str,
    text_prompt: str,
    confidence_threshold: float = 0.35,
) -> dict | None:
    """
    Detect an object described by text_prompt in the given frame.

    Returns:
        {"bbox": [x, y, w, h], "confidence": float} normalized to [0,1],
        or None if not detected / service unavailable.
    """
    if GROUNDING_DINO_URL:
        return await _detect_via_grounding_dino(frame_path, text_prompt, confidence_threshold)
    return await _detect_via_claude_fallback(frame_path, text_prompt)


async def _detect_via_grounding_dino(
    frame_path: str,
    text_prompt: str,
    threshold: float,
) -> dict | None:
    """Call a running Grounding DINO inference server."""
    try:
        with open(frame_path, "rb") as f:
            image_bytes = f.read()

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{GROUNDING_DINO_URL}/predict",
                files={"image": ("frame.jpg", image_bytes, "image/jpeg")},
                data={"prompt": text_prompt, "threshold": str(threshold)},
            )
            resp.raise_for_status()
            data = resp.json()

        boxes = data.get("boxes", [])
        if not boxes:
            return None

        # Take highest-confidence box
        best = max(boxes, key=lambda b: b.get("score", 0))
        if best.get("score", 0) < threshold:
            return None

        # Convert [x1,y1,x2,y2] normalized to [x,y,w,h]
        x1, y1, x2, y2 = best["box"]
        return {
            "bbox": [x1, y1, x2 - x1, y2 - y1],
            "confidence": round(best["score"], 3),
        }
    except Exception as e:
        print(f"[GroundingDINO] Request failed: {e}")
        return None


async def _detect_via_claude_fallback(
    frame_path: str,
    text_prompt: str,
) -> dict | None:
    """
    Fallback: ask Claude vision to estimate where an object is.
    Returns a rough bbox; less precise than Grounding DINO but always available.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("[GroundingDINO] No ANTHROPIC_API_KEY and no GROUNDING_DINO_URL — detection unavailable")
        return None

    try:
        import anthropic

        with open(frame_path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode()

        ext = Path(frame_path).suffix.lower()
        media_type = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=256,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                f"Locate '{text_prompt}' in this image. "
                                "If found, respond ONLY with a JSON object: "
                                '{"found": true, "bbox": [x, y, w, h], "confidence": 0.0-1.0} '
                                "where x,y,w,h are normalized 0-1 (x=left, y=top, w=width, h=height). "
                                'If not found: {"found": false}'
                            ),
                        },
                    ],
                }
            ],
        )

        text = response.content[0].text.strip()
        # Extract JSON from response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start == -1 or end == 0:
            return None

        result = json.loads(text[start:end])
        if not result.get("found"):
            return None

        return {
            "bbox": result["bbox"],
            "confidence": round(float(result.get("confidence", 0.5)), 3),
        }
    except Exception as e:
        print(f"[GroundingDINO] Claude fallback failed: {e}")
        return None
