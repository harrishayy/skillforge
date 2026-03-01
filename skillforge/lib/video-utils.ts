import type { Step, StepFrame, ClickTarget } from "@/types";

export interface ContainedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the actual display rectangle of a video inside a container that
 * uses `object-fit: contain`. Returns the offset and dimensions in the
 * container's coordinate space so overlay drawings can be mapped correctly.
 */
export function getContainedVideoRect(
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  containerHeight: number,
): ContainedRect {
  if (videoWidth <= 0 || videoHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }
  const videoAspect = videoWidth / videoHeight;
  const containerAspect = containerWidth / containerHeight;

  let w: number, h: number;
  if (videoAspect > containerAspect) {
    w = containerWidth;
    h = containerWidth / videoAspect;
  } else {
    h = containerHeight;
    w = containerHeight * videoAspect;
  }
  return {
    x: (containerWidth - w) / 2,
    y: (containerHeight - h) / 2,
    width: w,
    height: h,
  };
}

export function msToTimestamp(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function findCurrentStepIndex(steps: Step[], currentTimeMs: number): number {
  if (!steps.length) return 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (currentTimeMs >= steps[i].start_ms) return i;
  }
  return 0;
}

export function seekToStep(videoEl: HTMLVideoElement, step: Step) {
  videoEl.currentTime = step.start_ms / 1000;
}

/**
 * Returns click_targets whose frame_path matches the closest *segmented*
 * frame to the given video time. Only considers frames that actually have
 * click_targets (i.e., SAM3 produced masks for them), not just any frame
 * where Nemotron detected objects. This prevents empty results when the
 * nearest detected frame wasn't successfully segmented.
 *
 * Click_targets without a frame_path are shown unconditionally.
 */
export function getClickTargetsForTime(
  frames: StepFrame[],
  clickTargets: ClickTarget[],
  currentTimeMs: number,
): ClickTarget[] {
  if (!clickTargets.length) return [];

  const withPath: ClickTarget[] = [];
  const withoutPath: ClickTarget[] = [];
  const ctByFrame = new Map<string, ClickTarget[]>();

  for (const ct of clickTargets) {
    if (!ct.frame_path) {
      withoutPath.push(ct);
      continue;
    }
    withPath.push(ct);
    const list = ctByFrame.get(ct.frame_path) ?? [];
    list.push(ct);
    ctByFrame.set(ct.frame_path, list);
  }

  if (!withPath.length) return withoutPath.length ? withoutPath : clickTargets;

  // Build a set of frame_paths that have click_targets so we only match
  // against frames where SAM3 actually produced segments.
  const segmentedPaths = new Set(ctByFrame.keys());

  // Find the closest frame that has click_targets (not just object_detected).
  // Fall back to any detected frame if none match.
  let bestFrame: StepFrame | null = null;
  let bestDist = Infinity;

  for (const f of frames) {
    if (!segmentedPaths.has(f.frame_path)) continue;
    const dist = Math.abs(f.timestamp_ms - currentTimeMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestFrame = f;
    }
  }

  if (!bestFrame) {
    // No frame matched by path — just use the first available set
    const firstFramePath = ctByFrame.keys().next().value;
    return firstFramePath ? (ctByFrame.get(firstFramePath) ?? withoutPath) : withoutPath;
  }

  const matched = ctByFrame.get(bestFrame.frame_path) ?? [];
  return [...matched, ...withoutPath];
}
