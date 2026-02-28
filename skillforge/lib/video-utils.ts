import type { Step } from "@/types";

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
