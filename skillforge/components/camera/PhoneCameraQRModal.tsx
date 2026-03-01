"use client";

import { QRCodeSVG } from "qrcode.react";
import type { CameraRoomViewerStatus } from "@/hooks/usePhoneCameraSession";

interface PhoneCameraQRModalProps {
  /** QR-scannable URL built by usePhoneCameraSession */
  qrUrl: string;
  /** WebSocket status from the viewer */
  viewerStatus: CameraRoomViewerStatus;
  /** True once phone is connected and frames are arriving */
  isPhoneConnected: boolean;
  /** Called when the user clicks Close / Done */
  onClose: () => void;
}

/**
 * Full-screen overlay modal that shows a QR code for the user to scan with
 * their phone. Shared by the trainer recording page and the trainee learning view.
 */
export default function PhoneCameraQRModal({
  qrUrl,
  viewerStatus,
  isPhoneConnected,
  onClose,
}: PhoneCameraQRModalProps) {
  const statusText = isPhoneConnected
    ? "Phone connected"
    : viewerStatus === "connecting" || viewerStatus === "open"
      ? "Waiting for phone…"
      : viewerStatus === "error"
        ? "Connection error"
        : "Waiting for phone…";

  const statusColor = isPhoneConnected
    ? "var(--sf-lime)"
    : viewerStatus === "error"
      ? "var(--sf-orange)"
      : "#888";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
    >
      <div
        className="rounded-2xl p-6 max-w-sm w-full flex flex-col items-center gap-4"
        style={{ backgroundColor: "#111", border: "1px solid #333" }}
      >
        <h3
          className="font-bold text-lg"
          style={{ color: "var(--sf-white)" }}
        >
          Scan with your phone
        </h3>

        <p className="text-xs text-center" style={{ color: "#888" }}>
          Open the camera app or a QR scanner and scan to stream your phone
          camera to this laptop.
        </p>

        <div className="p-3 rounded-xl bg-white">
          <QRCodeSVG value={qrUrl || " "} size={200} level="M" />
        </div>

        {/* Localhost warning — only show client-side */}
        {typeof window !== "undefined" &&
          !process.env.NEXT_PUBLIC_APP_URL &&
          (window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1") && (
            <p className="text-xs text-center" style={{ color: "var(--sf-orange)" }}>
              Set NEXT_PUBLIC_APP_URL (e.g. http://172.21.160.1:3000) and
              NEXT_PUBLIC_WS_HOST (e.g. 172.21.160.1:8001) so your phone can
              reach this machine.
            </p>
          )}

        <p className="text-xs font-medium" style={{ color: statusColor }}>
          {statusText}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ backgroundColor: "#333", color: "var(--sf-white)" }}
        >
          {isPhoneConnected ? "Done" : "Close"}
        </button>
      </div>
    </div>
  );
}
