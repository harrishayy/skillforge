"use client";

import { useEffect, useRef, useState } from "react";
import { CAMERA_ROOM_WS } from "@/lib/constants";
import type { DetectionResult } from "@/hooks/useLiveDetect";

export type CameraRoomViewerStatus = "connecting" | "open" | "closed" | "error";

interface RemoteFrame {
  data: string;
  ts: number;
}

interface UseCameraRoomViewerOptions {
  sessionId: string | null;
  enabled: boolean;
}

interface UseCameraRoomViewerReturn {
  connectionStatus: CameraRoomViewerStatus;
  remoteFrame: RemoteFrame | null;
  remoteDetection: DetectionResult | null;
}

/**
 * When enabled, connects to the camera room WebSocket as consumer.
 * Exposes the latest remote_frame (base64 + ts) and detection (hands) from the server.
 */
export function useCameraRoomViewer({
  sessionId,
  enabled,
}: UseCameraRoomViewerOptions): UseCameraRoomViewerReturn {
  const [connectionStatus, setConnectionStatus] =
    useState<CameraRoomViewerStatus>("closed");
  const [remoteFrame, setRemoteFrame] = useState<RemoteFrame | null>(null);
  const [remoteDetection, setRemoteDetection] =
    useState<DetectionResult | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) {
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      setConnectionStatus("closed");
      setRemoteFrame(null);
      setRemoteDetection(null);
      return;
    }

    // When the viewer runs on the laptop at localhost, connect to localhost:8001 so the
    // viewer uses the local AR server. When using ngrok, the page origin is the ngrok URL
    // so no override; NEXT_PUBLIC_WS_HOST (the AR tunnel host) is used.
    const hostOverride =
      typeof window !== "undefined" && window.location.hostname === "localhost"
        ? "localhost:8001"
        : undefined;
    const url = CAMERA_ROOM_WS(sessionId, hostOverride);
    setConnectionStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ role: "consumer" }));
      setConnectionStatus("open");
      // Server expects consumer to keep connection open; some servers close if no input.
      // Send a no-op periodically so the connection is not considered idle (optional).
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch (err) {
            console.warn("[CameraRoom] Ping send failed — connection may have dropped:", err);
          }
        }
      }, 15000);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "remote_frame") {
          if (typeof msg.data === "string" && typeof msg.ts === "number") {
            setRemoteFrame({ data: msg.data, ts: msg.ts });
          }
          if (msg.hands !== undefined || msg.processing_ms !== undefined) {
            setRemoteDetection({
              hands: msg.hands ?? null,
              sam3_segments: [],
              processing_ms: typeof msg.processing_ms === "number" ? msg.processing_ms : 0,
            });
          }
        }
      } catch (err) {
        console.warn("[CameraRoom] Malformed WebSocket message:", err);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      setConnectionStatus("closed");
    };

    ws.onerror = () => {
      setConnectionStatus("error");
    };

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      ws.close(1000);
      wsRef.current = null;
      setConnectionStatus("closed");
    };
  }, [enabled, sessionId]);

  return { connectionStatus, remoteFrame, remoteDetection };
}
