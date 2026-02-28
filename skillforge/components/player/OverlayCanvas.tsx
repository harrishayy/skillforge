"use client";
import { useEffect, useRef } from "react";
import type { Step } from "@/types";
import {
  renderAnnotations,
  renderClickTargets,
} from "@/lib/annotation-renderer";
import { findCurrentStepIndex } from "@/lib/video-utils";
import { usePlayerStore } from "@/store/player-store";

interface OverlayCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  steps: Step[];
  workflowId: string;
  onStepChange?: (stepIndex: number) => void;
}

export function OverlayCanvas({
  videoRef,
  steps,
  workflowId,
  onStepChange,
}: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastStepIndexRef = useRef<number>(-1);
  const { setCurrentTimeMs, setCurrentStepIndex, setIsPausedAtStepEnd, currentStepIndex } =
    usePlayerStore();

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const syncCanvasSize = () => {
      const rect = video.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };

    const render = (time: number) => {
      syncCanvasSize();
      const currentMs = video.currentTime * 1000;
      setCurrentTimeMs(currentMs);

      const stepIdx = findCurrentStepIndex(steps, currentMs);

      // Notify on step change
      if (stepIdx !== lastStepIndexRef.current) {
        lastStepIndexRef.current = stepIdx;
        setCurrentStepIndex(stepIdx);
        onStepChange?.(stepIdx);
      }

      // Auto-pause at step end (if playing and not last step)
      const currentStep = steps[stepIdx];
      if (
        currentStep &&
        !video.paused &&
        stepIdx < steps.length - 1 &&
        currentMs >= currentStep.end_ms - 100
      ) {
        video.pause();
        setIsPausedAtStepEnd(true);
      }

      // Clear and redraw
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (currentStep) {
        renderAnnotations(ctx, currentStep.annotations, canvas.width, canvas.height, time);
        renderClickTargets(ctx, currentStep.click_targets, canvas.width, canvas.height, time);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [steps, videoRef, onStepChange, setCurrentTimeMs, setCurrentStepIndex, setIsPausedAtStepEnd]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
