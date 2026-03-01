"""
Multi-agent key object detection and segmentation pipeline.

Enhanced 3-agent chain for each step:
  1. Claude (Orchestrator Brain) — uses the full memory context (apparatus catalog,
     previous steps, current step) to decide WHICH and HOW MANY objects to detect.
     Returns N target objects, each with a label, role, and SAM3 prompt.
  2. Nemotron VL (Presence Scanner) — scans ALL frames for EACH target object
     independently (N objects x M frames).
  3. SAM3 (Segmentation) — called N times per positive frame (once per object
     concept), results merged with per-object labels.

Called by: services/hardware_pipeline.py after step metadata is generated.
"""
import os
import re
import json
import asyncio

import anthropic

from services.nemotron_client import detect_objects_in_frames_parallel
from services.sam3_service import segment_multi_concept, segment_concept


# ── Agent 1: Claude — decide which objects to detect and segment ─────────────

async def identify_key_objects(
    step_title: str,
    step_description: str,
    transcript: str,
    note: str = "",
    context: dict | None = None,
) -> list[dict]:
    """
    Claude analyzes the step with full memory context and decides which objects
    to detect and segment. Returns a list of target objects — could be 1, could be 3+.

    Each returned dict:
        {
            "label": "red wire to use",
            "object_type": "cable",
            "visual_cues": "red insulation, stripped ends",
            "sam3_prompt": "red insulated wire with stripped copper ends",
            "role": "primary",
            "reasoning": "This wire connects the power supply to the circuit board"
        }
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("[KeyObjectPipeline] No ANTHROPIC_API_KEY — falling back to single object", flush=True)
        return [_fallback_key_object(step_title)]

    combined_context = " ".join(filter(None, [transcript.strip(), note.strip()]))
    if not combined_context and not step_title:
        return [_fallback_key_object(step_title)]

    try:
        client = anthropic.Anthropic(api_key=api_key)

        system_prompt = _build_system_prompt(context)
        user_content = _build_user_prompt(
            step_title, step_description, transcript, note, context,
        )

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )

        text = response.content[0].text.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

        arr_match = re.search(r"\[.*\]", text, re.DOTALL)
        if arr_match:
            raw_list = json.loads(arr_match.group())
        else:
            obj_match = re.search(r"\{.*\}", text, re.DOTALL)
            if obj_match:
                raw_list = [json.loads(obj_match.group())]
            else:
                raise ValueError(f"No JSON in Claude response: {text[:200]}")

        objects = []
        for obj in raw_list:
            objects.append({
                "label": obj.get("label", obj.get("key_object", step_title)),
                "object_type": obj.get("object_type", "other"),
                "visual_cues": obj.get("visual_cues", ""),
                "sam3_prompt": obj.get("sam3_prompt", obj.get("label", step_title)),
                "role": obj.get("role", "primary"),
                "size_hint": obj.get("size_hint", "medium"),
                "reasoning": obj.get("reasoning", ""),
            })

        if not objects:
            objects = [_fallback_key_object(step_title)]

        labels_str = ", ".join(
            f'"{o["label"]}" ({o["role"]}, {o["size_hint"]})' for o in objects
        )
        print(f"[KeyObjectPipeline] Claude identified {len(objects)} target(s): {labels_str}", flush=True)
        return objects

    except anthropic.AuthenticationError as e:
        print(f"[KeyObjectPipeline] Claude auth failed: {e}", flush=True)
        return [_fallback_key_object(step_title)]
    except Exception as e:
        print(f"[KeyObjectPipeline] Claude identification failed ({type(e).__name__}): {e}", flush=True)
        return [_fallback_key_object(step_title)]


def _build_system_prompt(context: dict | None) -> str:
    base = (
        "You identify the physical objects a trainee should focus on in a tutorial step. "
        "You may return ONE or MULTIPLE objects depending on what the step requires.\n\n"
        "For example, if the step says 'plug the red wire into port 3', you should return "
        "TWO objects: the red wire (primary) and port 3 (context).\n\n"
        "Reply ONLY with a JSON array (no markdown fences):\n"
        '[{"label": "concise name for trainee", '
        '"object_type": "tool|part|connector|cable|component|container|material|other", '
        '"visual_cues": "color, shape, markings that help identify it", '
        '"sam3_prompt": "visually descriptive phrase for image segmentation (no verbs)", '
        '"role": "primary|context|warning", '
        '"size_hint": "large|medium|small", '
        '"reasoning": "why this object matters for this step"}]\n\n'
        "ROLE rules:\n"
        "- primary: the object the trainee directly acts on or uses\n"
        "- context: a supporting element (port, slot, target location)\n"
        "- warning: safety-critical element to be aware of\n\n"
        "SIZE_HINT rules (controls how the segmentation model finds the object):\n"
        "- large: easily visible objects that dominate a region of the frame "
        "(circuit boards, motors, tools, housings, containers)\n"
        "- medium: moderate-sized objects (wires, cables, large connectors, buttons)\n"
        "- small: tiny or precise components that occupy a very small area "
        "(individual pins, labeled ports like VIN/GND, SMD components, small switches, "
        "DIP switch positions, screw terminals, LED indicators)\n\n"
        "Keep the total to 1-4 objects. Every step must have at least one primary."
    )
    return base


def _build_user_prompt(
    step_title: str,
    step_description: str,
    transcript: str,
    note: str,
    context: dict | None,
) -> str:
    parts = []

    if context:
        wf = context.get("workflow", {})
        if wf.get("title"):
            parts.append(f'Workflow: "{wf["title"]}"')
            if wf.get("description"):
                parts.append(f"Workflow description: {wf['description']}")

        catalog = context.get("apparatus_catalog", [])
        if catalog:
            catalog_lines = []
            for obj in catalog:
                catalog_lines.append(
                    f"  - {obj['object_name']} ({obj.get('object_type', 'other')}): "
                    f"{obj.get('visual_cues', '')} | SAM3: \"{obj.get('sam3_prompt', '')}\""
                )
            parts.append("Known apparatus/tools:\n" + "\n".join(catalog_lines))

        prev_steps = context.get("previous_steps", [])
        if prev_steps:
            prev_lines = []
            for ps in prev_steps:
                objs = ", ".join(ps.get("objects_used", [])) or "none identified"
                prev_lines.append(
                    f"  Step {ps['step_number']}: \"{ps.get('title', '')}\" — objects used: {objs}"
                )
                if ps.get("observations"):
                    prev_lines.append(f"    Observation: {ps['observations'][:150]}")
            parts.append("Previous steps:\n" + "\n".join(prev_lines))

    parts.append(f'Current step title: "{step_title}"')
    if step_description:
        parts.append(f'Step description: "{step_description}"')
    if transcript:
        parts.append(f'Expert narration: "{transcript}"')
    if note:
        parts.append(f'Expert note: "{note}"')

    parts.append("\nIdentify the target object(s) for this step and return the JSON array.")

    return "\n\n".join(parts)


def _fallback_key_object(title: str) -> dict:
    return {
        "label": title or "object",
        "object_type": "other",
        "visual_cues": "",
        "sam3_prompt": title or "object",
        "role": "primary",
        "reasoning": "",
    }


# ── Legacy wrapper for backward compatibility ────────────────────────────────

async def identify_key_object(
    step_title: str,
    step_description: str,
    transcript: str,
    note: str = "",
    workflow_title: str = "",
    workflow_description: str = "",
) -> dict:
    """
    Legacy single-object interface. Wraps identify_key_objects() and returns
    the first primary object in the old format for backward compatibility.
    """
    context = {
        "workflow": {"title": workflow_title, "description": workflow_description},
        "apparatus_catalog": [],
        "previous_steps": [],
    }
    objects = await identify_key_objects(
        step_title, step_description, transcript, note, context,
    )
    primary = next((o for o in objects if o["role"] == "primary"), objects[0])
    return {
        "key_object": primary["label"],
        "object_type": primary["object_type"],
        "visual_cues": primary["visual_cues"],
        "action": "",
        "sam3_prompt": primary["sam3_prompt"],
    }


# ── Agent 2: Nemotron VL — scan frames for each target object ────────────────

async def scan_frames_for_objects(
    frame_paths: list[str],
    target_objects: list[dict],
    on_progress=None,
    step_context: str | None = None,
) -> dict[str, list[dict]]:
    """
    For each target object, scan all frames for presence using Nemotron VL.
    All objects are scanned in parallel (interleaved with a shared semaphore)
    rather than sequentially.

    Args:
        step_context: Optional rich context (title, description, transcript)
            from the Claude Haiku refinement stage, passed to Nemotron.

    Returns:
        {
            "object_label": [
                {"frame_path": str, "present": bool, "description": str},
                ...
            ],
            ...
        }
    """
    objects_with_frames: list[tuple[str, str, list[str]]] = []
    for i, obj in enumerate(target_objects):
        label = obj.get("label", f"object_{i}")
        desc = obj["label"]
        if obj.get("visual_cues"):
            desc += f" — {obj['visual_cues']}"
        objects_with_frames.append((label, desc, frame_paths))

    if on_progress:
        labels = ", ".join(f'"{l}"' for l, _, _ in objects_with_frames)
        await on_progress(
            f"Scanning {len(objects_with_frames)} objects in parallel: {labels}...",
            0, len(target_objects),
        )

    results = await detect_objects_in_frames_parallel(
        objects_with_frames, step_context=step_context,
    )

    for label, detections in results.items():
        positive = sum(1 for d in detections if d["present"])
        print(
            f"[KeyObjectPipeline] Nemotron: \"{label}\" found in {positive}/{len(frame_paths)} frames",
            flush=True,
        )

    return results


async def scan_frames_for_object(
    frame_paths: list[str],
    key_object: dict,
    on_progress=None,
) -> list[dict]:
    """Legacy single-object scan. Wraps scan_frames_for_objects()."""
    target = {
        "label": key_object.get("key_object", key_object.get("label", "")),
        "visual_cues": key_object.get("visual_cues", ""),
    }
    results = await scan_frames_for_objects(frame_paths, [target], on_progress)
    return list(results.values())[0] if results else []


# ── Agent 3: SAM3 — multi-object segmentation ────────────────────────────────

_NEMOTRON_PREAMBLE = re.compile(
    r"^(The image (shows?|contains?|depicts?|does not)|"
    r"Yes,?\s*|No,?\s*|"
    r"The object (is|in the image)|"
    r"There is a?n?\s*|"
    r"In the image,?\s*|"
    r"It (is|shows?)\s*)",
    re.IGNORECASE,
)


def _clean_nemotron_for_sam3(desc: str) -> str:
    """
    Strip conversational preamble from a Nemotron description so SAM3
    receives a concise visual noun-phrase rather than a full sentence.

    'The Arduino Uno board is visible in the image, characterized by its
     blue PCB and USB connector' → 'Arduino Uno board, blue PCB and USB connector'
    """
    if not desc:
        return ""
    cleaned = _NEMOTRON_PREAMBLE.sub("", desc).strip(" ,;:.")
    if not cleaned:
        return ""
    cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned


SAM3_PARALLEL_BATCH = 6


async def _segment_single_frame(
    frame_path: str,
    objects_present: list[dict],
    confidence_threshold: float,
) -> dict | None:
    """
    Segment all target objects in a single frame via full-frame text prompts.

    Each object in objects_present may carry a '_nemotron_desc' field — the
    visual description Nemotron returned for this specific frame.  When
    available it replaces the generic Claude sam3_prompt, giving SAM3 a
    concrete visual description (colors, shapes, spatial context) instead
    of an abstract functional label.
    """
    from pathlib import Path

    try:
        frame_bytes = Path(frame_path).read_bytes()

        prompts = []
        for obj in objects_present:
            nemotron_desc = _clean_nemotron_for_sam3(obj.get("_nemotron_desc", ""))
            prompt = nemotron_desc if nemotron_desc else obj["sam3_prompt"]
            if nemotron_desc:
                print(
                    f"[KeyObjectPipeline] SAM3 prompt for \"{obj['label']}\" "
                    f"enriched by Nemotron: \"{prompt[:80]}\"",
                    flush=True,
                )
            prompts.append({
                "label": obj["label"],
                "sam3_prompt": prompt,
                "role": obj.get("role", "primary"),
            })

        seg_result = await segment_multi_concept(
            frame_bytes, prompts, confidence_threshold,
        )
        segments = seg_result.get("segments", [])

        if segments:
            return {"frame_path": frame_path, "segments": segments}

    except Exception as e:
        print(f"[KeyObjectPipeline] Multi-object segmentation failed: {e}", flush=True)
        return {"frame_path": frame_path, "segments": []}

    return None


async def segment_positive_frames_multi(
    frame_paths: list[str],
    target_objects: list[dict],
    detection_results: dict[str, list[dict]],
    confidence_threshold: float = 0.15,
) -> list[dict]:
    """
    For each frame, determine which target objects are present (from Nemotron
    results), then segment all of them via full-frame text-prompt SAM3.

    Processes frames in parallel batches of SAM3_PARALLEL_BATCH for throughput.

    Returns list of {frame_path, segments} where each segment includes
    label and role metadata.
    """
    frame_object_map: dict[str, list[dict]] = {fp: [] for fp in frame_paths}

    for obj in target_objects:
        label = obj.get("label", "")
        detections = detection_results.get(label, [])
        for det in detections:
            if det["present"] and det["frame_path"] in frame_object_map:
                frame_object_map[det["frame_path"]].append({
                    **obj,
                    "_nemotron_desc": det.get("description", ""),
                })

    work_items = [
        (fp, objs) for fp, objs in frame_object_map.items() if objs
    ]

    results: list[dict] = []
    for i in range(0, len(work_items), SAM3_PARALLEL_BATCH):
        batch = work_items[i : i + SAM3_PARALLEL_BATCH]
        batch_results = await asyncio.gather(
            *[
                _segment_single_frame(fp, objs, confidence_threshold)
                for fp, objs in batch
            ],
            return_exceptions=True,
        )
        for r in batch_results:
            if isinstance(r, Exception):
                print(f"[KeyObjectPipeline] SAM3 batch error: {r}", flush=True)
                continue
            if r is not None:
                results.append(r)

    return results


async def segment_positive_frames(
    positive_frames: list[dict],
    sam3_prompt: str,
    confidence_threshold: float = 0.15,
) -> list[dict]:
    """
    Legacy single-prompt segmentation. Kept for backward compatibility with
    editor rerun-pipeline and other callers.
    """
    from pathlib import Path

    results = []
    for frame_info in positive_frames:
        frame_path = frame_info["frame_path"]
        try:
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


# ── Orchestrators ─────────────────────────────────────────────────────────────

async def run_key_object_analysis_multi(
    frame_paths: list[str],
    step_title: str,
    step_description: str,
    transcript: str,
    note: str = "",
    context: dict | None = None,
    on_progress=None,
) -> dict:
    """
    Full multi-agent pipeline for a single step with memory context:
      1. Claude decides which objects to segment (1..N)
      2. Nemotron scans all frames for each object independently
      3. SAM3 segments each object in its positive frames, merges per frame

    Returns:
        {
            "target_objects": [dict],
            "detection_results": {label: [per-frame results]},
            "segmentations": [{"frame_path": str, "segments": [...]}],
            "positive_frame_counts": {label: int},
            "total_frame_count": int,
        }
    """
    if on_progress:
        await on_progress("Identifying target objects from step context...", 0, 3)

    target_objects = await identify_key_objects(
        step_title, step_description, transcript, note, context,
    )

    if on_progress:
        labels = ", ".join(f'"{o["label"]}"' for o in target_objects)
        await on_progress(f"Target objects: {labels} — scanning frames...", 1, 3)

    # Build rich context for Nemotron from the Claude Haiku refinement stage
    nemotron_context_parts = []
    if step_title:
        nemotron_context_parts.append(f'Step: "{step_title}"')
    if step_description:
        nemotron_context_parts.append(f'Description: "{step_description}"')
    if transcript:
        nemotron_context_parts.append(f'Expert narration: "{transcript[:300]}"')
    nemotron_context = (
        "Context for this frame:\n" + "\n".join(f"- {p}" for p in nemotron_context_parts)
        if nemotron_context_parts else None
    )

    detection_results = await scan_frames_for_objects(
        frame_paths, target_objects, on_progress=None,
        step_context=nemotron_context,
    )

    positive_counts = {}
    for label, detections in detection_results.items():
        positive_counts[label] = sum(1 for d in detections if d["present"])

    total_positive = sum(positive_counts.values())
    if on_progress:
        await on_progress(
            f"Found objects in frames — segmenting {total_positive} detections...", 2, 3,
        )

    segmentations = await segment_positive_frames_multi(
        frame_paths, target_objects, detection_results,
    )

    # Build spatial descriptions for objects Nemotron detected but SAM3
    # couldn't segment — pick the longest description per object.
    segmented_labels: set[str] = set()
    for seg_result in segmentations:
        for seg in seg_result.get("segments", []):
            if seg.get("label"):
                segmented_labels.add(seg["label"])

    spatial_descriptions: dict[str, str] = {}
    for obj in target_objects:
        label = obj.get("label", "")
        if label in segmented_labels:
            continue
        if positive_counts.get(label, 0) == 0:
            continue
        detections = detection_results.get(label, [])
        best_desc = max(
            (d.get("description", "") for d in detections if d.get("present")),
            key=len,
            default="",
        )
        if best_desc:
            spatial_descriptions[label] = best_desc
            print(
                f"[KeyObjectPipeline] Spatial fallback for \"{label}\": {best_desc[:100]}",
                flush=True,
            )

    total_segments = sum(len(s["segments"]) for s in segmentations)
    print(
        f"[KeyObjectPipeline] Multi-object complete: {len(target_objects)} objects, "
        f"{total_segments} total segments across {len(segmentations)} frames",
        flush=True,
    )

    return {
        "target_objects": target_objects,
        "detection_results": detection_results,
        "segmentations": segmentations,
        "positive_frame_counts": positive_counts,
        "total_frame_count": len(frame_paths),
        "spatial_descriptions": spatial_descriptions,
    }


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
    Legacy single-object interface. Returns the old format for backward
    compatibility with callers that haven't migrated to the multi-object API.
    """
    context = {
        "workflow": {"title": workflow_title, "description": workflow_description},
        "apparatus_catalog": [],
        "previous_steps": [],
    }
    multi = await run_key_object_analysis_multi(
        frame_paths, step_title, step_description, transcript, note,
        context=context, on_progress=on_progress,
    )

    primary = next(
        (o for o in multi["target_objects"] if o["role"] == "primary"),
        multi["target_objects"][0] if multi["target_objects"] else _fallback_key_object(step_title),
    )

    all_detections = []
    for label, dets in multi["detection_results"].items():
        for det in dets:
            if det not in all_detections:
                all_detections.append(det)

    primary_label = primary["label"]
    positive_count = multi["positive_frame_counts"].get(primary_label, 0)

    return {
        "key_object": {
            "key_object": primary["label"],
            "object_type": primary["object_type"],
            "visual_cues": primary["visual_cues"],
            "action": "",
            "sam3_prompt": primary["sam3_prompt"],
        },
        "frame_detections": all_detections,
        "segmentations": multi["segmentations"],
        "positive_frame_count": positive_count,
        "total_frame_count": multi["total_frame_count"],
    }
