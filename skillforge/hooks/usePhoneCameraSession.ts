"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useCameraRoomViewer,
  type CameraRoomViewerStatus,
} from "@/hooks/useCameraRoomViewer";

export type { CameraRoomViewerStatus };

export interface PhoneCameraSession {
  /** Null when no session is active */
  remoteSessionId: string | null;
  /** QR-scannable URL for the phone to open (empty string during SSR or before session starts) */
  qrUrl: string;
  /** WebSocket connection status to AR backend */
  viewerStatus: CameraRoomViewerStatus;
  /** Latest JPEG frame from the phone (base64 data + timestamp) */
  remoteFrame: { data: string; ts: number } | null;
  /** Latest hand detection result from the AR backend */
  remoteDetection: import("@/hooks/useLiveDetect").DetectionResult | null;
  /** True once the WS is open and at least one frame has arrived */
  isPhoneConnected: boolean;
  /** Generate a new session ID and start the viewer */
  startRemoteSession: () => void;
  /** Close the viewer and clear the session ID */
  stopRemoteSession: () => void;
}

/**
 * Shared hook for using a phone as a remote camera source.
 * Used by the trainer recording page and the trainee learning view.
 *
 * Usage:
 *   const phone = usePhoneCameraSession();
 *   // Start:  phone.startRemoteSession()
 *   // QR:     <QRCodeSVG value={phone.qrUrl} />
 *   // Stop:   phone.stopRemoteSession()
 *   // Hands:  phone.remoteDetection?.hands
 *   // Frame:  phone.remoteFrame?.data  (base64 JPEG)
 */
export function usePhoneCameraSession(): PhoneCameraSession {
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string>("");

  const { connectionStatus, remoteFrame, remoteDetection } =
    useCameraRoomViewer({
      sessionId: remoteSessionId,
      enabled: !!remoteSessionId,
    });

  // Build QR URL client-side only (same pattern as live/page.tsx to avoid SSR mismatch)
  useEffect(() => {
    if (!remoteSessionId) {
      setQrUrl("");
      return;
    }
    if (typeof window === "undefined") return;

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const wsHost =
      process.env.NEXT_PUBLIC_WS_HOST ||
      (process.env.NEXT_PUBLIC_APP_URL
        ? `${new URL(process.env.NEXT_PUBLIC_APP_URL).hostname}:8001`
        : `${window.location.hostname}:8001`);

    setQrUrl(
      `${appUrl.replace(/\/$/, "")}/live?mode=camera&session=${remoteSessionId}&host=${encodeURIComponent(wsHost)}`
    );
  }, [remoteSessionId]);

  const startRemoteSession = useCallback(() => {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRemoteSessionId(id);
  }, []);

  const stopRemoteSession = useCallback(() => {
    setRemoteSessionId(null);
  }, []);

  return {
    remoteSessionId,
    qrUrl,
    viewerStatus: connectionStatus,
    remoteFrame,
    remoteDetection,
    isPhoneConnected: connectionStatus === "open" && !!remoteFrame,
    startRemoteSession,
    stopRemoteSession,
  };
}
