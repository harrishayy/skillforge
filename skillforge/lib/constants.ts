export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

export const PIPELINE_WS = (workflowId: string) =>
  `${WS_BASE}/ws/pipeline/${workflowId}`;

export const UPLOADS_BASE = `${API_BASE}/uploads`;

/**
 * Resolve a frame or video path to a full URL.
 * - If the path is already an absolute URL (R2 / CDN), return it unchanged.
 * - Otherwise prepend the API base to serve from the local /uploads static mount.
 */
export const frameUrl = (path: string): string =>
  path.startsWith("http") ? path : `${API_BASE}/${path}`;

export const videoUrl = (path: string): string =>
  path.startsWith("http") ? path : `${API_BASE}/${path}`;

export const PHYSICAL_PIPELINE_WS = (workflowId: string) =>
  `${WS_BASE}/ws/pipeline/${workflowId}`;

export const LIVE_SESSION_WS = (sessionId: string) =>
  `${WS_BASE}/ws/live/${sessionId}`;

/** WebSocket URL for AR camera stream (phone → laptop pose server). Set NEXT_PUBLIC_WS_HOST to e.g. "192.168.1.5:8000" for phone-to-laptop. */
export const AR_STREAM_WS = () =>
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_HOST
    ? `ws://${process.env.NEXT_PUBLIC_WS_HOST}/ws/ar`
    : `${WS_BASE}/ws/ar`;

/** WebSocket URL for live hand detection (VIDEO mode, 30 FPS). */
export const LIVE_DETECT_WS = () =>
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_HOST
    ? `ws://${process.env.NEXT_PUBLIC_WS_HOST}/ws/live/detect`
    : `${WS_BASE}/ws/live/detect`;
