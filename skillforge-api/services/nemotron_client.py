"""
SOFTWARE WORKFLOW — Nemotron VL frame analysis for screen recording decomposition.
Used exclusively by: services/workflow_builder.py (software pipeline).

Physical workflows use GroundingDINO + DINOv2 in: services/physical_pipeline.py
"""
import json
import re
import os
import asyncio
import httpx
from utils.frame_utils import resize_frame_for_api

NIM_API_BASE = "https://integrate.api.nvidia.com/v1"
NIM_MODEL = "nvidia/nemotron-nano-vl-12b-v2"

_SYSTEM_PROMPT = """You are a visual analysis expert examining a frame from a software screen recording.
Analyze the frame and return ONLY a valid JSON object (no markdown, no explanation) with these fields:
{
  "app_name": "name of application or context shown",
  "current_action": "one sentence describing what is happening",
  "ui_elements": [
    {"element_type": "button|input|menu|link|icon|text", "label": "text/name", "location": "top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right"}
  ],
  "step_boundary": true or false,
  "step_description": "if step_boundary is true: one sentence describing the new step being started",
  "important_regions": [
    {"label": "description", "bbox_percent": {"x": 0-100, "y": 0-100, "w": 0-100, "h": 0-100}}
  ]
}"""


async def analyze_frame(
    frame_path: str,
    api_key: str | None = None,
) -> dict:
    """Analyze a single software screen-recording frame with Nemotron VL via NIM API."""
    key = api_key or os.environ.get("NVIDIA_NIM_API_KEY", "")
    image_b64 = resize_frame_for_api(frame_path, max_size=1024)
    system_prompt = _SYSTEM_PROMPT

    payload = {
        "model": NIM_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                    {"type": "text", "text": system_prompt},
                ],
            }
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{NIM_API_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json=payload,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]

    return _parse_json_response(content)


def _parse_json_response(text: str) -> dict:
    """Extract JSON from model response robustly."""
    # Try direct parse first
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try extracting bare JSON object
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    # Fallback: return raw text as ai_description
    return {
        "app_name": "unknown",
        "current_action": text[:200],
        "ui_elements": [],
        "step_boundary": False,
        "step_description": "",
        "important_regions": [],
        "raw_text": text,
    }


async def analyze_frames_batch(
    frames: list[dict],
    api_key: str | None = None,
    on_progress = None,
    batch_size: int = 4,
) -> list[dict]:
    """Analyze all software screen-recording frames, batching requests for throughput."""
    results = []
    total = len(frames)

    for i in range(0, total, batch_size):
        batch = frames[i : i + batch_size]
        tasks = [analyze_frame(f["path"], api_key) for f in batch]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        for j, (frame, result) in enumerate(zip(batch, batch_results)):
            if isinstance(result, Exception):
                result = {"error": str(result), "step_boundary": False, "ui_elements": [], "important_regions": []}
            results.append({**frame, "vl_analysis": result})

        done = min(i + batch_size, total)
        pct = 10 + int((done / total) * 40)  # 10-50% range
        if on_progress:
            await on_progress(f"Nemotron VL: analyzed {done}/{total} frames", pct)

    return results
