"use client";

import { useEffect, useRef, useState } from "react";
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

    // The viewer always runs on the laptop, so connect directly to the local AR
    // backend. Use explicit ws:// to avoid wss:// being inferred from the page
    // origin when accessed via ngrok (browsers allow ws://localhost from https
    // pages via the loopback mixed-content exception).
    const url = `ws://localhost:8001/ws/camera/${sessionId}`;
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
