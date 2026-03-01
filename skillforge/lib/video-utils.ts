import type { Step, StepFrame, ClickTarget } from "@/types";

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
 * Returns click_targets whose frame_path matches the closest detected frame
 * to the given video time. Always returns the nearest match so the overlay
 * stays visible throughout playback when detections exist. Click_targets
 * without a frame_path are shown unconditionally.
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

  let bestFrame: StepFrame | null = null;
  let bestDist = Infinity;

  for (const f of frames) {
    if (!f.object_detected) continue;
    const dist = Math.abs(f.timestamp_ms - currentTimeMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestFrame = f;
    }
  }

  if (!bestFrame) {
    const firstFramePath = ctByFrame.keys().next().value;
    return firstFramePath ? (ctByFrame.get(firstFramePath) ?? withoutPath) : withoutPath;
  }

  const matched = ctByFrame.get(bestFrame.frame_path) ?? [];
  return [...matched, ...withoutPath];
}
