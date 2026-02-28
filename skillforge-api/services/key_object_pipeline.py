"""
Multi-agent key object detection and segmentation pipeline.

3-agent chain for each step:
  1. Claude (Context Synthesizer) — identifies the key object from transcript/notes/workflow context
  2. Nemotron VL (Presence Scanner) — scans ALL frames for binary object presence
  3. SAM3 (Segmentation) — segments the object only in frames where Nemotron found it

Called by: services/hardware_pipeline.py after step metadata is generated.
"""
import os
import json
import anthropic

from services.nemotron_client import detect_object_in_frames_batch
from services.sam3_service import segment_concept


# ── Agent 1: Claude — identify key object from step context ───────────────────

async def identify_key_object(
    step_title: str,
    step_description: str,
    transcript: str,
    note: str = "",
    workflow_title: str = "",
    workflow_description: str = "",
) -> dict:
    """
    Use Claude Haiku to identify the single most important object the trainee
    should focus on in this step. Returns a structured descriptor.

    Returns:
        {
            "key_object": "the red emergency stop button",
            "object_type": "button",
            "visual_cues": "red, circular, labeled E-STOP",
            "action": "press firmly to stop the machine",
            "sam3_prompt": "red circular emergency stop button labeled E-STOP"
        }
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("[KeyObjectPipeline] ⚠ No ANTHROPIC_API_KEY — skipping key object identification", flush=True)
        return _fallback_key_object(step_title)

    combined_context = " ".join(filter(None, [transcript.strip(), note.strip()]))
    if not combined_context and not step_title:
        return _fallback_key_object(step_title)

    try:
        client = anthropic.Anthropic(api_key=api_key)

        user_content = f'Workflow: "{workflow_title}"'
        if workflow_description:
            user_content += f"\nWorkflow description: {workflow_description}"
        user_content += f'\n\nStep title: "{step_title}"'
        if step_description:
            user_content += f'\nStep description: "{step_description}"'
        if transcript:
            user_content += f'\nExpert narration: "{transcript}"'
        if note:
            user_content += f'\nExpert note: "{note}"'
        user_content += "\n\nIdentify the key object and return the JSON."

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system=(
                "You identify the single most important physical object or element a trainee "
                "should focus on in a tutorial step. Reply ONLY with valid JSON:\n"
                '{"key_object": "concise name", "object_type": "tool|part|button|switch|component|container|material|other", '
                '"visual_cues": "color, shape, text, or markings that help identify it visually", '
                '"action": "what the trainee should do with this object", '
                '"sam3_prompt": "a concise, visually descriptive phrase for image segmentation (no verbs, just the object appearance)"}'
            ),
            messages=[{"role": "user", "content": user_content}],
        )

        text = response.content[0].text.strip()
        data = json.loads(text)
        print(f'[KeyObjectPipeline] Claude identified: "{data.get("key_object", "?")}" → SAM3 prompt: "{data.get("sam3_prompt", "?")}"', flush=True)
        return {
            "key_object": data.get("key_object", step_title),
            "object_type": data.get("object_type", "other"),
            "visual_cues": data.get("visual_cues", ""),
            "action": data.get("action", ""),
            "sam3_prompt": data.get("sam3_prompt", data.get("key_object", step_title)),
        }

    except Exception as e:
        print(f"[KeyObjectPipeline] Claude key object identification failed: {e}", flush=True)
        return _fallback_key_object(step_title)


def _fallback_key_object(title: str) -> dict:
    return {
        "key_object": title or "object",
        "object_type": "other",
        "visual_cues": "",
        "action": "",
        "sam3_prompt": title or "object",
    }


# ── Agent 2: Nemotron VL — scan all frames for object presence ───────────────

async def scan_frames_for_object(
    frame_paths: list[str],
    key_object: dict,
    on_progress=None,
) -> list[dict]:
    """
    Scan all frames using Nemotron VL to check if the key object is present.

    Returns list of {frame_path, present, description} for each frame.
    """
    object_desc = (
        f'{key_object["key_object"]}'
        f' — {key_object["visual_cues"]}'
        if key_object.get("visual_cues")
        else key_object["key_object"]
    )

    return await detect_object_in_frames_batch(
        frame_paths=frame_paths,
        object_description=object_desc,
        on_progress=on_progress,
    )


# ── Agent 3: SAM3 — segment object in positive frames ────────────────────────

async def segment_positive_frames(
    positive_frames: list[dict],
    sam3_prompt: str,
    confidence_threshold: float = 0.35,
) -> list[dict]:
    """
    Run SAM3 text-prompted segmentation on frames where Nemotron confirmed
    the object is present. Returns list of {frame_path, segments}.
    """
    results = []
    for frame_info in positive_frames:
        frame_path = frame_info["frame_path"]
        try:
            from pathlib import Path
            frame_bytes = Path(frame_path).read_bytes()
            sam_result = await segment_concept(
                frame_bytes, sam3_prompt, confidence_threshold,
            )
            segments = sam_result["segments"] if sam_result else []
            if segments:
                scores_str = ", ".join(f"{s['score']:.0%}" for s in segments)
                print(f"[KeyObjectPipeline] SAM3 segmented {len(segments)} object(s) [{scores_str}] in frame", flush=True)
            results.append({"frame_path": frame_path, "segments": segments})
        except Exception as e:
            print(f"[KeyObjectPipeline] SAM3 segmentation failed: {e}", flush=True)
            results.append({"frame_path": frame_path, "segments": []})

    return results


# ── Orchestrator — runs the full 3-agent chain ───────────────────────────────

async def run_key_object_analysis(
    frame_paths: list[str],
    step_title: str,
    step_description: str,
    transcript: str,
    note: str = "",
    workflow_title: str = "",
    workflow_description: str = "",
    on_progress=None,
) -> dict:
    """
    Full multi-agent pipeline for a single step:
      1. Claude identifies the key object from context
      2. Nemotron scans all frames for presence
      3. SAM3 segments the object in positive frames

    Returns:
        {
            "key_object": dict,          # Claude's object descriptor
            "frame_detections": [         # Per-frame Nemotron results
                {"frame_path": str, "present": bool, "description": str}
            ],
            "segmentations": [            # SAM3 results for positive frames only
                {"frame_path": str, "segments": [...]}
            ],
            "positive_frame_count": int,
            "total_frame_count": int,
        }
    """
    if on_progress:
        await on_progress("Identifying key object from step context...", 0, 3)

    # Agent 1: Claude
    key_object = await identify_key_object(
        step_title, step_description, transcript, note,
        workflow_title, workflow_description,
    )

    if on_progress:
        await on_progress(f'Key object: "{key_object["key_object"]}" — scanning frames...', 1, 3)

    # Agent 2: Nemotron
    frame_detections = await scan_frames_for_object(
        frame_paths, key_object, on_progress=None,
    )

    positive_frames = [fd for fd in frame_detections if fd["present"]]
    positive_count = len(positive_frames)
    total_count = len(frame_paths)

    if on_progress:
        await on_progress(
            f"Object found in {positive_count}/{total_count} frames — segmenting...", 2, 3,
        )

    # Agent 3: SAM3
    segmentations = []
    if positive_frames:
        segmentations = await segment_positive_frames(
            positive_frames, key_object["sam3_prompt"],
        )

    print(
        f"[KeyObjectPipeline] Complete: "
        f'"{key_object["key_object"]}" found in {positive_count}/{total_count} frames, '
        f"{sum(len(s['segments']) for s in segmentations)} total segments",
        flush=True,
    )

    return {
        "key_object": key_object,
        "frame_detections": frame_detections,
        "segmentations": segmentations,
        "positive_frame_count": positive_count,
        "total_frame_count": total_count,
    }
