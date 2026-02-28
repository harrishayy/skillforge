/**
 * Wire contract for AR camera stream WebSocket.
 * Client sends frames; server responds with ack or pose (projection/view matrices).
 */

/** Client → Server: single frame as base64 JPEG. */
export interface ARFrameMessage {
  type: "frame";
  data: string;
  ts?: number;
}

/** Server → Client: placeholder or real pose (4x4 row-major). */
export interface ARPoseMessage {
  type: "pose";
  view_matrix?: number[];
  projection_matrix?: number[];
}

/** Server → Client: simple ack. */
export interface ARAckMessage {
  type: "ack";
}

export type ARServerMessage = ARPoseMessage | ARAckMessage;
