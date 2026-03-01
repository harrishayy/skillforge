"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_ROOM_WS } from "@/lib/constants";

const CAPTURE_WIDTH = 1920;
const CAPTURE_HEIGHT = 1080;
const JPEG_QUALITY = 0.7;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

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
 *
 * Auto-reconnects on abnormal closure (code ≠ 1000/1001) up to MAX_RECONNECT_ATTEMPTS
 * times with a RECONNECT_DELAY_MS delay between attempts. This handles:
 *   - React Strict Mode double-mount causing rapid close
 *   - Transient ngrok connection drops
 *   - OS/browser page suspension during camera permission prompt
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
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const roleSentRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const activeRef = useRef(false); // tracks whether this effect instance is still mounted

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
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      roleSentRef.current = false;
      reconnectCountRef.current = 0;
      setConnectionStatus("closed");
      return;
    }

    activeRef.current = true;
    reconnectCountRef.current = 0;

    const connect = () => {
      if (!activeRef.current) return;

      const url = CAMERA_ROOM_WS(sessionId, host ?? undefined);
      setConnectionStatus("connecting");
      roleSentRef.current = false;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!activeRef.current) { ws.close(1000); return; }
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

      ws.onclose = (event) => {
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

        // Auto-reconnect on abnormal closure (not intentional 1000/1001).
        // Code 1006 = TCP dropped without close frame (React Strict Mode or network blip).
        const isAbnormal = event.code !== 1000 && event.code !== 1001;
        if (isAbnormal && activeRef.current && reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectCountRef.current);
          reconnectCountRef.current += 1;
          console.log(
            `[CameraRoomProducer] Abnormal close (${event.code}), reconnect attempt ${reconnectCountRef.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`
          );
          reconnectRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        setConnectionStatus("error");
      };
    };

    connect();

    return () => {
      activeRef.current = false;
      if (startDelayRef.current) {
        clearTimeout(startDelayRef.current);
        startDelayRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      roleSentRef.current = false;
      reconnectCountRef.current = 0;
      setConnectionStatus("closed");
    };
  }, [enabled, sessionId, host, targetFps, captureAndSend]);

  return { connectionStatus };
}
