"use client";
import { useEffect, useRef, useMemo } from "react";
import type { Step } from "@/types";
import { getClickTargetsForTime } from "@/lib/video-utils";
import { renderClickTargets } from "@/lib/annotation-renderer";

interface StepVideoOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  step: Step;
}

/**
 * Canvas overlay that renders SAM3 segmentation bounding boxes in sync with
 * per-step video playback. Reads video.currentTime each animation frame,
 * finds the nearest detected frame, and draws matching click_targets.
 */
export function StepVideoOverlay({ videoRef, step }: StepVideoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const frames = useMemo(() => step.frames ?? [], [step.frames]);
  const clickTargets = useMemo(() => step.click_targets ?? [], [step.click_targets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = (time: number) => {
      const rect = video.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const currentMs = video.currentTime * 1000;
      const visible = getClickTargetsForTime(frames, clickTargets, currentMs);

      if (visible.length > 0) {
        renderClickTargets(ctx, visible, canvas.width, canvas.height, time);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef, frames, clickTargets]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
