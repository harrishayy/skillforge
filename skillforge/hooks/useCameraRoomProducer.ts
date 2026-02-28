"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_ROOM_WS } from "@/lib/constants";

const CAPTURE_WIDTH = 1920;
const CAPTURE_HEIGHT = 1080;
const JPEG_QUALITY = 0.7;

export type CameraRoomProducerStatus = "connecting" | "open" | "closed" | "error";

interface UseCameraRoomProducerOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sessionId: string | null;
  host?: string | null;
  enabled: boolean;
  targetFps?: number;
}

interface UseCameraRoomProducerReturn {
  connectionStatus: CameraRoomProducerStatus;
}

/**
 * When enabled, connects to the camera room WebSocket as producer, sends role,
 * then streams frames from the given video ref at 1920×1080 (1080p).
 */
export function useCameraRoomProducer({
  videoRef,
  sessionId,
  host,
  enabled,
  targetFps = 24,
}: UseCameraRoomProducerOptions): UseCameraRoomProducerReturn {
  const [connectionStatus, setConnectionStatus] =
    useState<CameraRoomProducerStatus>("closed");

  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const roleSentRef = useRef(false);

  const captureAndSend = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !roleSentRef.current) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Phone camera feed is often 90° rotated; rotate -90° so it displays correctly on the laptop.
    ctx.save();
    ctx.translate(0, CAPTURE_HEIGHT);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(
      video,
      0,
      0,
      video.videoWidth,
      video.videoHeight,
      0,
      0,
      CAPTURE_HEIGHT,
      CAPTURE_WIDTH
    );
    ctx.restore();
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = dataUrl.split(",")[1];
    if (!base64) return;
    try {
      ws.send(JSON.stringify({ type: "frame", data: base64, ts: Date.now() }));
    } catch {
      // send failed
    }
  }, [videoRef]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      roleSentRef.current = false;
      setConnectionStatus("closed");
      return;
    }

    const url = CAMERA_ROOM_WS(sessionId, host ?? undefined);
    setConnectionStatus("connecting");
    roleSentRef.current = false;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ role: "producer" }));
        roleSentRef.current = true;
        setConnectionStatus("open");
        startDelayRef.current = setTimeout(() => {
          startDelayRef.current = null;
          if (intervalRef.current) return;
          intervalRef.current = setInterval(captureAndSend, 1000 / targetFps);
        }, 400);
      } catch {
        setConnectionStatus("error");
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      roleSentRef.current = false;
      if (startDelayRef.current) {
        clearTimeout(startDelayRef.current);
        startDelayRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setConnectionStatus("closed");
    };

    ws.onerror = () => {
      setConnectionStatus("error");
    };

    return () => {
      if (startDelayRef.current) {
        clearTimeout(startDelayRef.current);
        startDelayRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      ws.close(1000);
      wsRef.current = null;
      roleSentRef.current = false;
      setConnectionStatus("closed");
    };
  }, [enabled, sessionId, host, targetFps, captureAndSend]);

  return { connectionStatus };
}
