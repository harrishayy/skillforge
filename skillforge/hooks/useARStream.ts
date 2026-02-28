"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AR_STREAM_WS } from "@/lib/constants";
import type { ARPoseMessage, ARServerMessage } from "@/types/ar-stream";

const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;
const JPEG_QUALITY = 0.75;

export type ARStreamConnectionStatus = "connecting" | "open" | "closed" | "error";

interface UseARStreamOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  targetFps?: number;
}

interface UseARStreamReturn {
  connectionStatus: ARStreamConnectionStatus;
  lastPose: ARPoseMessage | null;
  lastAckTs: number | null;
}

/**
 * When enabled, streams frames from the given video ref to the AR WebSocket at 640×480.
 * Exposes connection status and last pose/ack from the server.
 */
export function useARStream({
  videoRef,
  enabled,
  targetFps = 12,
}: UseARStreamOptions): UseARStreamReturn {
  const [connectionStatus, setConnectionStatus] = useState<ARStreamConnectionStatus>("closed");
  const [lastPose, setLastPose] = useState<ARPoseMessage | null>(null);
  const [lastAckTs, setLastAckTs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const captureAndSend = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = dataUrl.split(",")[1];
    if (!base64) return;
    try {
      wsRef.current.send(JSON.stringify({ type: "frame", data: base64, ts: Date.now() }));
    } catch {
      // send failed
    }
  }, [videoRef]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      setConnectionStatus("closed");
      return;
    }

    const url = AR_STREAM_WS();
    setConnectionStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus("open");
      intervalRef.current = setInterval(captureAndSend, 1000 / targetFps);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as ARServerMessage;
        if (msg.type === "pose") {
          setLastPose(msg);
          setLastAckTs(Date.now());
        } else if (msg.type === "ack") {
          setLastAckTs(Date.now());
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
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
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      ws.close(1000);
      wsRef.current = null;
      setConnectionStatus("closed");
    };
  }, [enabled, targetFps, captureAndSend]);

  return { connectionStatus, lastPose, lastAckTs };
}
