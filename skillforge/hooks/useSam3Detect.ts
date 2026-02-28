"use client";

import { useCallback, useEffect, useRef } from "react";
import { API_BASE } from "@/lib/constants";

export interface Sam3Segment {
  mask_base64: string;
  bbox: number[];
  score: number;
}

export interface Sam3Result {
  sam3_segments: Sam3Segment[];
  processing_ms: number;
}

interface UseSam3DetectOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  textPrompt: string;
  intervalMs: number;
  confidenceThreshold?: number;
  enabled: boolean;
  onResult: (result: Sam3Result) => void;
}

/**
 * Captures frames on an interval and sends them via HTTP POST to the
 * skillforge-api /api/live/detect-frame endpoint with mode "sam3".
 * This routes through sam3_service → remote GPU server for inference.
 */
export function useSam3Detect({
  videoRef,
  textPrompt,
  intervalMs,
  confidenceThreshold = 0.35,
  enabled,
  onResult,
}: UseSam3DetectOptions) {
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const textPromptRef = useRef(textPrompt);
  textPromptRef.current = textPrompt;

  const captureAndSend = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || inflightRef.current) return;

    if (!frameCanvasRef.current) {
      frameCanvasRef.current = document.createElement("canvas");
    }
    const fc = frameCanvasRef.current;
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    fc.width = Math.round(video.videoWidth * scale);
    fc.height = Math.round(video.videoHeight * scale);
    const ctx = fc.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, fc.width, fc.height);
    const dataUrl = fc.toDataURL("image/jpeg", 0.6);
    const frame_base64 = dataUrl.split(",")[1];
    if (!frame_base64 || !textPromptRef.current) return;

    inflightRef.current = true;
    try {
      const resp = await fetch(`${API_BASE}/api/live/detect-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frame_base64,
          modes: ["sam3"],
          text_prompt: textPromptRef.current,
          confidence_threshold: confidenceThreshold,
        }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      onResultRef.current({
        sam3_segments: data.sam3_segments ?? [],
        processing_ms: data.processing_ms ?? 0,
      });
    } catch {
      // non-fatal — skip this frame
    } finally {
      inflightRef.current = false;
    }
  }, [videoRef, confidenceThreshold]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(captureAndSend, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, intervalMs, captureAndSend]);
}
