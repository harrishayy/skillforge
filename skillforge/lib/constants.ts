export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

export const PIPELINE_WS = (workflowId: string) =>
  `${WS_BASE}/ws/pipeline/${workflowId}`;

export const UPLOADS_BASE = `${API_BASE}/uploads`;

export const frameUrl = (path: string): string =>
  `${API_BASE}/${path}`;

export const videoUrl = (path: string): string =>
  `${API_BASE}/${path}`;

export const PHYSICAL_PIPELINE_WS = (workflowId: string) =>
  `${WS_BASE}/ws/pipeline/${workflowId}`;

export const LIVE_SESSION_WS = (sessionId: string) =>
  `${WS_BASE}/ws/live/${sessionId}`;

const _wsProtocol = (): "ws" | "wss" =>
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_APP_URL &&
  process.env.NEXT_PUBLIC_APP_URL.startsWith("https")
    ? "wss"
    : "ws";

/** WebSocket URL for AR camera stream (phone → laptop pose server). Set NEXT_PUBLIC_WS_HOST to e.g. "192.168.1.5:8000" for phone-to-laptop. Uses wss when NEXT_PUBLIC_APP_URL is https. */
export const AR_STREAM_WS = () => {
  const protocol = _wsProtocol();
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_HOST)
    return `${protocol}://${process.env.NEXT_PUBLIC_WS_HOST}/ws/ar`;
  return `${WS_BASE}/ws/ar`;
};

/** WebSocket URL for live hand detection (VIDEO mode, 30 FPS). Uses wss when NEXT_PUBLIC_APP_URL is https. */
export const LIVE_DETECT_WS = () => {
  const protocol = _wsProtocol();
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_HOST)
    return `${protocol}://${process.env.NEXT_PUBLIC_WS_HOST}/ws/live/detect`;
  return `${WS_BASE}/ws/live/detect`;
};

/** WebSocket URL for camera room (session-scoped). Use host from QR when on phone. Uses wss when NEXT_PUBLIC_APP_URL is https. */
export const CAMERA_ROOM_WS = (sessionId: string, host?: string): string => {
  const protocol = _wsProtocol();
  if (typeof host === "string" && host.length > 0) {
    const base =
      host.startsWith("ws://") || host.startsWith("wss://")
        ? host
        : `${protocol}://${host}`;
    return `${base.replace(/\/$/, "")}/ws/camera/${sessionId}`;
  }
  const wsHost =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_HOST
      ? process.env.NEXT_PUBLIC_WS_HOST
      : null;
  const base = wsHost ? `${protocol}://${wsHost}` : WS_BASE;
  return `${base.replace(/\/$/, "")}/ws/camera/${sessionId}`;
};
