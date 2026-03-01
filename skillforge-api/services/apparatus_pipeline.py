"""
Apparatus showcase analysis pipeline.

Processes the apparatus showcase video recorded before step-by-step recording:
  1. Extract frames (~1fps)
  2. Claude identifies all distinct tools/parts/apparatus and groups frames
  3. Nemotron verifies object presence across frames (multi-angle confirmation)
  4. SAM3 segments each object on its best frame for reference
  5. Results stored in workflow_objects table

Called by: services/hardware_pipeline.py before step processing begins.
"""
import os
import re
import json
import base64
from pathlib import Path

import anthropic

from services.video_processor import extract_frames
from services.nemotron_client import detect_object_in_frames_batch
from services.sam3_service import segment_concept
from services.memory_layer import save_apparatus_object, clear_apparatus_catalog


UPLOADS_DIR = Path(__file__).parent.parent / "uploads"


async def run_apparatus_analysis(
    workflow_id: str,
    apparatus_video_path: str,
    on_progress=None,
) -> list[dict]:
    """
    Full apparatus showcase analysis pipeline.

    Returns list of cataloged objects:
        [{"id": str, "object_name": str, "object_type": str, ...}, ...]
    """
    if on_progress:
        await on_progress("Extracting frames from apparatus showcase...", 0)

    frames = await extract_frames(apparatus_video_path, workflow_id)
    if not frames:
        print("[ApparatusPipeline] No frames extracted from apparatus video", flush=True)
        return []

    if on_progress:
        await on_progress(f"Extracted {len(frames)} frames — identifying objects...", 20)

    objects = await _claude_identify_apparatus(frames, workflow_id)
    if not objects:
        print("[ApparatusPipeline] Claude found no apparatus objects", flush=True)
        return []

    if on_progress:
        await on_progress(f"Found {len(objects)} objects — verifying with Nemotron...", 40)

    objects = await _nemotron_verify_objects(frames, objects)

    if on_progress:
        await on_progress(f"Running SAM3 reference segmentation...", 60)

    objects = await _sam3_reference_segmentation(frames, objects)

    if on_progress:
        await on_progress(f"Saving {len(objects)} apparatus objects to catalog...", 80)

    await clear_apparatus_catalog(workflow_id)
    saved = []
    for obj in objects:
        obj_id = await save_apparatus_object(
            workflow_id=workflow_id,
            object_name=obj["object_name"],
            object_type=obj.get("object_type", "other"),
            visual_cues=obj.get("visual_cues", ""),
            sam3_prompt=obj.get("sam3_prompt", obj["object_name"]),
            angle_count=obj.get("angle_count", 0),
            reference_frame_paths=obj.get("reference_frames", []),
        )
        saved.append({**obj, "id": obj_id})

    if on_progress:
        await on_progress(f"Apparatus catalog complete: {len(saved)} objects", 100)

    print(
        f"[ApparatusPipeline] Cataloged {len(saved)} objects: "
        + ", ".join(o["object_name"] for o in saved),
        flush=True,
    )
    return saved


async def _claude_identify_apparatus(
    frames: list[dict],
    workflow_id: str,
) -> list[dict]:
    """
    Send frames to Claude to identify all distinct apparatus/tools/parts.
    Returns a list of object descriptors with frame groupings.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("[ApparatusPipeline] No ANTHROPIC_API_KEY — skipping identification", flush=True)
        return []

    sampled = _sample_frames(frames, max_frames=20)
    if not sampled:
        return []

    image_content = []
    frame_index_map = {}
    for i, frm in enumerate(sampled):
        fpath = frm["path"]
        try:
            img_bytes = Path(fpath).read_bytes()
            b64 = base64.b64encode(img_bytes).decode()
            image_content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
            })
            image_content.append({
                "type": "text",
                "text": f"[Frame {i+1}, timestamp {frm['timestamp_ms']}ms]",
            })
            frame_index_map[i + 1] = frm
        except Exception as e:
            print(f"[ApparatusPipeline] Failed to read frame {fpath}: {e}", flush=True)

    if not image_content:
        return []

    image_content.append({
        "type": "text",
        "text": (
            "These are frames from an apparatus showcase video where a trainer shows all "
            "tools, parts, and components needed for a hands-on tutorial.\n\n"
            "Identify ALL distinct physical objects/tools/parts shown. For each, provide:\n"
            "- object_name: concise name\n"
            "- object_type: tool|part|connector|cable|component|container|material|other\n"
            "- visual_cues: color, shape, markings, labels that distinguish it\n"
            "- sam3_prompt: a visually descriptive phrase for image segmentation (no verbs)\n"
            "- frame_numbers: which frame numbers (1-indexed) show this object\n\n"
            "Reply ONLY with a JSON array, no markdown fences:\n"
            '[{"object_name": "...", "object_type": "...", "visual_cues": "...", '
            '"sam3_prompt": "...", "frame_numbers": [1, 3, 5]}]'
        ),
    })

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system=(
                "You are an expert at identifying physical tools, parts, and components "
                "from video frames. Be thorough — identify every distinct object visible. "
                "Reply with ONLY a JSON array."
            ),
            messages=[{"role": "user", "content": image_content}],
        )

        text = response.content[0].text.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        arr_match = re.search(r"\[.*\]", text, re.DOTALL)
        if not arr_match:
            print(f"[ApparatusPipeline] No JSON array in Claude response: {text[:200]}", flush=True)
            return []

        raw_objects = json.loads(arr_match.group())

        objects = []
        for obj in raw_objects:
            frame_nums = obj.get("frame_numbers", [])
            ref_frames = []
            for fn in frame_nums:
                frm = frame_index_map.get(fn)
                if frm:
                    ref_frames.append(frm["relative_path"])

            objects.append({
                "object_name": obj.get("object_name", "unknown"),
                "object_type": obj.get("object_type", "other"),
                "visual_cues": obj.get("visual_cues", ""),
                "sam3_prompt": obj.get("sam3_prompt", obj.get("object_name", "object")),
                "angle_count": len(ref_frames),
                "reference_frames": ref_frames,
                "_frame_paths": [
                    frame_index_map[fn]["path"]
                    for fn in frame_nums
                    if fn in frame_index_map
                ],
            })

        print(
            f"[ApparatusPipeline] Claude identified {len(objects)} objects: "
            + ", ".join(o["object_name"] for o in objects),
            flush=True,
        )
        return objects

    except Exception as e:
        print(f"[ApparatusPipeline] Claude apparatus identification failed: {e}", flush=True)
        return []


async def _nemotron_verify_objects(
    frames: list[dict],
    objects: list[dict],
) -> list[dict]:
    """
    For each identified object, run Nemotron across frames to confirm
    which frames actually contain it (multi-angle verification).
    Updates reference_frames and angle_count.
    """
    all_frame_paths = [f["path"] for f in frames]
    path_to_rel = {f["path"]: f["relative_path"] for f in frames}

    for obj in objects:
        desc = obj["object_name"]
        if obj.get("visual_cues"):
            desc += f" — {obj['visual_cues']}"

        try:
            detections = await detect_object_in_frames_batch(
                frame_paths=all_frame_paths,
                object_description=desc,
                batch_size=4,
            )
            positive_paths = [d["frame_path"] for d in detections if d["present"]]
            obj["reference_frames"] = [path_to_rel[p] for p in positive_paths if p in path_to_rel]
            obj["angle_count"] = len(positive_paths)
            obj["_frame_paths"] = positive_paths

            print(
                f"[ApparatusPipeline] Nemotron: \"{obj['object_name']}\" found in "
                f"{len(positive_paths)}/{len(all_frame_paths)} frames",
                flush=True,
            )
        except Exception as e:
            print(f"[ApparatusPipeline] Nemotron verification failed for {obj['object_name']}: {e}", flush=True)

    return objects


async def _sam3_reference_segmentation(
    frames: list[dict],
    objects: list[dict],
) -> list[dict]:
    """
    Run SAM3 on the best frame for each object to get a reference segmentation.
    Picks the middle frame from the object's positive frames.
    """
    for obj in objects:
        fpaths = obj.get("_frame_paths", [])
        if not fpaths:
            continue

        best_frame = fpaths[len(fpaths) // 2]
        try:
            frame_bytes = Path(best_frame).read_bytes()
            result = await segment_concept(
                frame_bytes,
                obj["sam3_prompt"],
                confidence_threshold=0.3,
            )
            if result and result.get("segments"):
                score = max(s.get("score", 0) for s in result["segments"])
                print(
                    f"[ApparatusPipeline] SAM3 reference: \"{obj['object_name']}\" "
                    f"segmented at {score:.0%}",
                    flush=True,
                )
        except Exception as e:
            print(f"[ApparatusPipeline] SAM3 reference failed for {obj['object_name']}: {e}", flush=True)

    for obj in objects:
        obj.pop("_frame_paths", None)

    return objects


def _sample_frames(frames: list[dict], max_frames: int = 20) -> list[dict]:
    """Evenly sample frames to stay within API limits."""
    if len(frames) <= max_frames:
        return frames
    step = len(frames) / max_frames
    return [frames[int(i * step)] for i in range(max_frames)]
