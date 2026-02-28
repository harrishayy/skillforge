"use client";

import { useCallback, useEffect, useRef } from "react";
import { LIVE_DETECT_WS } from "@/lib/constants";

export type DetectMode = "hands" | "sam3";

export interface HandData {
  hand_count: number;
  hands: Array<{ landmarks: Array<{ x: number; y: number }> }>;
  pointing_at: { x: number; y: number } | null;
}

export interface Sam3Segment {
  mask_base64: string;
  bbox: number[];
  score: number;
}

export interface DetectionResult {
  hands: HandData | null;
  sam3_segments: Sam3Segment[];
  processing_ms: number;
}

interface UseLiveDetectOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  modes: Set<DetectMode>;
  textPrompt: string;
  intervalMs: number;
  enabled: boolean;
  onResult: (result: DetectionResult) => void;
}

/** Max 60 FPS: minimum ms between frames when user selects "as fast as possible" (interval 0). */
const FRAME_CAP_MS = 1000 / 60;

/**
 * Captures frames from a video element on an interval and sends them
 * over WebSocket to /ws/live/detect (VIDEO mode). Interval 0 = as fast as possible, capped at 60 FPS.
 * Does not wait for response before sending next frame; server uses "process latest only".
 */
export function useLiveDetect({
  videoRef,
  modes,
  textPrompt,
  intervalMs,
  enabled,
  onResult,
}: UseLiveDetectOptions) {
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const effectiveIntervalMs = intervalMs <= 0 ? FRAME_CAP_MS : intervalMs;

  const captureAndSend = useCallback(() => {
    const video = videoRef.current;
    const ws = wsRef.current;
    if (!video || video.readyState < 2 || !ws || ws.readyState !== WebSocket.OPEN) return;

    if (!frameCanvasRef.current) {
      frameCanvasRef.current = document.createElement("canvas");
    }
    const fc = frameCanvasRef.current;
    fc.width = video.videoWidth;
    fc.height = video.videoHeight;
    const ctx = fc.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = fc.toDataURL("image/jpeg", 0.75);
    const frame_base64 = dataUrl.split(",")[1];
    if (!frame_base64) return;

    try {
      ws.send(
        JSON.stringify({
          type: "frame",
          data: frame_base64,
          timestamp_ms: Date.now(),
        })
      );
    } catch {
      // non-fatal
    }
  }, [videoRef]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      wsRef.current?.close(1000);
      wsRef.current = null;
      return;
    }

    const url = LIVE_DETECT_WS();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      intervalRef.current = setInterval(captureAndSend, effectiveIntervalMs);
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "error") return;
        if (
          typeof data.hands !== "undefined" &&
          typeof data.processing_ms === "number"
        ) {
          onResultRef.current(data as DetectionResult);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      wsRef.current = null;
    };

    ws.onerror = () => {
      ws.close();
    };

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      ws.close(1000);
      wsRef.current = null;
    };
  }, [enabled, effectiveIntervalMs, captureAndSend]);
}
