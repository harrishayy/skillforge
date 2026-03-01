"use client";
import { useEffect, useRef } from "react";
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

  const framesRef = useRef(step.frames ?? []);
  const clickTargetsRef = useRef(step.click_targets ?? []);
  const prevTargetCountRef = useRef(0);

  framesRef.current = step.frames ?? [];
  clickTargetsRef.current = step.click_targets ?? [];

  const detectedCount = (step.frames ?? []).filter((f) => f.object_detected).length;
  const targetCount = (step.click_targets ?? []).length;

  useEffect(() => {
    if (targetCount !== prevTargetCountRef.current) {
      const detected = framesRef.current.filter((f) => f.object_detected).length;
      console.log(
        `[StepVideoOverlay] Step "${step.title}" — ${targetCount} click_targets, ` +
        `${detected} detected frames out of ${framesRef.current.length} total`,
      );
      prevTargetCountRef.current = targetCount;
    }
  }, [targetCount, step.title]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastVisibleCount = -1;

    const render = (time: number) => {
      const rect = video.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const currentMs = video.currentTime * 1000;
      const visible = getClickTargetsForTime(
        framesRef.current,
        clickTargetsRef.current,
        currentMs,
      );

      if (visible.length !== lastVisibleCount) {
        if (visible.length > 0 && lastVisibleCount <= 0) {
          console.log(`[StepVideoOverlay] Rendering ${visible.length} SAM3 target(s) at ${Math.round(currentMs)}ms`);
        }
        lastVisibleCount = visible.length;
      }

      if (visible.length > 0) {
        renderClickTargets(ctx, visible, canvas.width, canvas.height, time);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    console.log(`[StepVideoOverlay] RAF loop started — ${clickTargetsRef.current.length} click_targets available`);
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
    />
  );
}
