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
import asyncio
import base64
from pathlib import Path

import anthropic

from services.video_processor import extract_frames
from services.nemotron_client import detect_objects_in_frames_parallel
from services.sam3_service import segment_concept, generate_segmented_image
from services.memory_layer import save_apparatus_object, clear_apparatus_catalog
from services.key_object_pipeline import _clean_nemotron_for_sam3


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

    objects = await _sam3_reference_segmentation(frames, objects, workflow_id=workflow_id)

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
            description=obj.get("visual_cues", ""),
            segmented_reference_path=obj.get("segmented_reference_path", ""),
            segmented_frame_paths=obj.get("segmented_frame_paths"),
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
            "Identify ONLY the tools, parts, and components the trainer is deliberately "
            "presenting for the tutorial. For each, provide:\n"
            "- object_name: concise name\n"
            "- object_type: tool|part|connector|cable|component|container|material\n"
            "- visual_cues: color, shape, markings, labels that distinguish it\n"
            "- sam3_prompt: a visually descriptive phrase for image segmentation (no verbs)\n"
            "- frame_numbers: which frame numbers (1-indexed) show this object\n\n"
            "EXCLUDE: the trainer's body, hands, clothing, eyeglasses, jewelry, "
            "anything the trainer is NOT deliberately showcasing as a tutorial component.\n\n"
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
                "from video frames. ONLY identify objects that are clearly tutorial apparatus "
                "— tools, electronic components, wires, boards, mechanical parts, materials, "
                "and connectors. NEVER include personal items (glasses, watches, bottles, phones), "
                "body parts, clothing, or environmental objects (walls, furniture, screens). "
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

        _VALID_TYPES = {"tool", "part", "connector", "cable", "component", "container", "material"}
        _REJECT_KEYWORDS = {
            "glasses", "eyeglasses", "spectacles", "sunglasses",
            "watch", "ring", "bracelet", "necklace", "earring",
            "bottle", "cup", "mug", "phone", "laptop", "shirt",
            "pants", "shoe", "hat", "cap", "bag", "backpack",
            "wall", "table", "desk", "chair", "floor", "ceiling",
            "door", "window", "hand", "finger", "face", "hair",
        }

        objects = []
        skipped = []
        for obj in raw_objects:
            obj_type = obj.get("object_type", "other").lower()
            obj_name = obj.get("object_name", "unknown").lower()

            if obj_type not in _VALID_TYPES:
                skipped.append(obj.get("object_name", "unknown"))
                continue
            if any(kw in obj_name for kw in _REJECT_KEYWORDS):
                skipped.append(obj.get("object_name", "unknown"))
                continue

            frame_nums = obj.get("frame_numbers", [])
            ref_frames = []
            for fn in frame_nums:
                frm = frame_index_map.get(fn)
                if frm:
                    ref_frames.append(frm["relative_path"])

            objects.append({
                "object_name": obj.get("object_name", "unknown"),
                "object_type": obj_type,
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

        if skipped:
            print(
                f"[ApparatusPipeline] Filtered out {len(skipped)} irrelevant objects: "
                + ", ".join(skipped),
                flush=True,
            )

        print(
            f"[ApparatusPipeline] Claude identified {len(objects)} objects: "
            + ", ".join(o["object_name"] for o in objects),
            flush=True,
        )
        return objects

    except Exception as e:
        print(f"[ApparatusPipeline] Claude apparatus identification failed: {e}", flush=True)
        return []


NEMOTRON_VERIFY_MAX_FRAMES = 10


async def _nemotron_verify_objects(
    frames: list[dict],
    objects: list[dict],
) -> list[dict]:
    """
    For each identified object, run Nemotron across a subsampled set of frames
    to confirm which frames actually contain it (multi-angle verification).
    All objects are verified in parallel with a shared concurrency semaphore.
    Updates reference_frames and angle_count.
    """
    sampled_frames = _subsample_list(frames, NEMOTRON_VERIFY_MAX_FRAMES)
    all_frame_paths = [f["path"] for f in sampled_frames]
    path_to_rel = {f["path"]: f["relative_path"] for f in frames}

    objects_with_frames: list[tuple[str, str, list[str]]] = []
    for obj in objects:
        desc = obj["object_name"]
        if obj.get("visual_cues"):
            desc += f" — {obj['visual_cues']}"
        objects_with_frames.append((obj["object_name"], desc, all_frame_paths))

    try:
        all_results = await detect_objects_in_frames_parallel(objects_with_frames)
    except Exception as e:
        print(f"[ApparatusPipeline] Nemotron parallel verification failed: {e}", flush=True)
        return objects

    for obj in objects:
        detections = all_results.get(obj["object_name"], [])
        positive = [d for d in detections if d["present"]]
        positive_paths = [d["frame_path"] for d in positive]
        obj["reference_frames"] = [path_to_rel[p] for p in positive_paths if p in path_to_rel]
        obj["angle_count"] = len(positive_paths)
        obj["_frame_paths"] = positive_paths
        obj["_frame_descriptions"] = {
            d["frame_path"]: d.get("description", "")
            for d in positive
            if d.get("description")
        }

        print(
            f"[ApparatusPipeline] Nemotron: \"{obj['object_name']}\" found in "
            f"{len(positive_paths)}/{len(all_frame_paths)} frames",
            flush=True,
        )

    return objects


MAX_SEGMENTED_FRAMES_PER_OBJECT = 4
SAM3_APPARATUS_CONCURRENT = 6


async def _segment_one_apparatus_frame(
    sem: asyncio.Semaphore,
    frame_path: str,
    sam3_prompt: str,
    object_name: str,
    safe_name: str,
    frame_index: int,
    apparatus_dir: Path,
    workflow_id: str,
    path_to_rel: dict[str, str],
    frame_descriptions: dict[str, str] | None = None,
) -> dict | None:
    """Segment a single (object, frame) pair under the shared semaphore."""
    async with sem:
        try:
            frame_bytes = Path(frame_path).read_bytes()

            prompt = sam3_prompt
            if frame_descriptions:
                nemotron_desc = _clean_nemotron_for_sam3(
                    frame_descriptions.get(frame_path, "")
                )
                if nemotron_desc:
                    prompt = nemotron_desc

            result = await segment_concept(
                frame_bytes,
                prompt,
                confidence_threshold=0.20,
            )

            if not result or not result.get("segments"):
                return None

            score = max(s.get("score", 0) for s in result["segments"])
            out_filename = f"{safe_name}_seg_{frame_index}.jpg"
            out_path = str(apparatus_dir / out_filename)
            saved = generate_segmented_image(
                frame_path, result["segments"], out_path,
                label=object_name,
            )
            if saved:
                rel_seg = f"uploads/{workflow_id}/apparatus/{out_filename}"
                rel_orig = path_to_rel.get(frame_path, "")
                return {
                    "object_name": object_name,
                    "rel_seg": rel_seg,
                    "rel_orig": rel_orig,
                    "score": score,
                }

        except Exception as e:
            print(
                f"[ApparatusPipeline] SAM3 failed for \"{object_name}\" "
                f"frame {frame_index + 1}: {e}",
                flush=True,
            )
        return None


async def _sam3_reference_segmentation(
    frames: list[dict],
    objects: list[dict],
    workflow_id: str = "",
) -> list[dict]:
    """
    Run SAM3 on all positive frames for each object (up to a limit).
    All (object, frame) pairs are processed in parallel with a shared
    semaphore. Generates overlay images and builds segmented_frame_paths
    and segmented_reference_path per object.
    """
    apparatus_dir = UPLOADS_DIR / workflow_id / "apparatus"
    apparatus_dir.mkdir(parents=True, exist_ok=True)
    path_to_rel = {f["path"]: f["relative_path"] for f in frames}
    sem = asyncio.Semaphore(SAM3_APPARATUS_CONCURRENT)

    coros = []
    coro_obj_names: list[str] = []

    for obj in objects:
        fpaths = obj.get("_frame_paths", [])
        if not fpaths:
            continue

        sampled = _subsample_list(fpaths, MAX_SEGMENTED_FRAMES_PER_OBJECT)
        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", obj["object_name"])
        frame_descriptions = obj.get("_frame_descriptions", {})

        for i, frame_path in enumerate(sampled):
            coros.append(
                _segment_one_apparatus_frame(
                    sem, frame_path, obj["sam3_prompt"], obj["object_name"],
                    safe_name, i, apparatus_dir, workflow_id,
                    path_to_rel, frame_descriptions,
                )
            )
            coro_obj_names.append(obj["object_name"])

    results = await asyncio.gather(*coros, return_exceptions=True)

    obj_seg_maps: dict[str, dict[str, str]] = {obj["object_name"]: {} for obj in objects}
    obj_best: dict[str, tuple[float, str]] = {obj["object_name"]: (0.0, "") for obj in objects}

    for name, result in zip(coro_obj_names, results):
        if isinstance(result, Exception):
            print(f"[ApparatusPipeline] SAM3 parallel error for \"{name}\": {result}", flush=True)
            continue
        if result is None:
            continue
        if result["rel_orig"]:
            obj_seg_maps[name][result["rel_orig"]] = result["rel_seg"]
        score, best_path = obj_best[name]
        if result["score"] > score:
            obj_best[name] = (result["score"], result["rel_seg"])

    for obj in objects:
        name = obj["object_name"]
        seg_map = obj_seg_maps.get(name, {})
        obj["segmented_frame_paths"] = seg_map
        best_score, best_seg_path = obj_best.get(name, (0.0, ""))
        obj["segmented_reference_path"] = best_seg_path

        if seg_map:
            print(
                f"[ApparatusPipeline] SAM3: \"{name}\" — "
                f"{len(seg_map)} frames segmented (best {best_score:.0%})",
                flush=True,
            )
        else:
            n_tried = sum(1 for n in coro_obj_names if n == name)
            if n_tried > 0:
                print(
                    f"[ApparatusPipeline] SAM3: \"{name}\" — "
                    f"0/{n_tried} frames passed threshold (no segmentation)",
                    flush=True,
                )

    for obj in objects:
        obj.pop("_frame_paths", None)
        obj.pop("_frame_descriptions", None)

    return objects


def _subsample_list(items: list, max_items: int) -> list:
    """Evenly subsample a list, always keeping first and last."""
    if len(items) <= max_items:
        return items
    indices = [round(i * (len(items) - 1) / (max_items - 1)) for i in range(max_items)]
    return [items[i] for i in dict.fromkeys(indices)]


def _sample_frames(frames: list[dict], max_frames: int = 20) -> list[dict]:
    """Evenly sample frames to stay within API limits."""
    if len(frames) <= max_frames:
        return frames
    step = len(frames) / max_frames
    return [frames[int(i * step)] for i in range(max_frames)]
