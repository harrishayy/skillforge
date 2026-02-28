import type { HandData } from "@/hooks/useLiveDetect";

/** MediaPipe hand landmark indices. */
const THUMB_TIP = 4;
const INDEX_TIP = 8;

/** 3D distance below this (in 0–1 normalized space) counts as pinch. */
export const PINCH_THRESHOLD = 0.05;

/**
 * Normalize landmark to 0–1 space for distance. x/y are 0–100 from our pipeline; z is MediaPipe scale (~0–1).
 */
function toNormalized(lm: { x: number; y: number; z: number }) {
  return {
    x: lm.x / 100,
    y: lm.y / 100,
    z: lm.z,
  };
}

function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Returns whether the hand's thumb tip and index tip are close in 3D (pinch).
 */
function isHandPinching(landmarks: Array<{ x: number; y: number; z: number }>): boolean {
  if (landmarks.length <= Math.max(THUMB_TIP, INDEX_TIP)) return false;
  const p4 = toNormalized(landmarks[THUMB_TIP]);
  const p8 = toNormalized(landmarks[INDEX_TIP]);
  return distance3d(p4, p8) < PINCH_THRESHOLD;
}

export interface PinchState {
  leftPressed: boolean;
  rightPressed: boolean;
}

/**
 * Compute current pinch state from hand data. Left/right from handedness; each side is true when that hand is pinching (3D distance below threshold).
 */
export function computePinchState(hands: HandData | null): PinchState {
  const state: PinchState = { leftPressed: false, rightPressed: false };
  if (!hands?.hands?.length) return state;

  for (const hand of hands.hands) {
    const { landmarks, handedness } = hand;
    if (!handedness || landmarks.length <= INDEX_TIP) continue;
    const pinching = isHandPinching(landmarks);
    if (handedness === "Left") state.leftPressed = pinching;
    else if (handedness === "Right") state.rightPressed = pinching;
  }
  return state;
}
