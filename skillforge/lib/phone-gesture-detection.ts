import type { HandData } from "@/hooks/useLiveDetect";

/** MediaPipe hand landmark indices (21 landmarks). */
const WRIST = 0;
const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_TIP = 8;
const INDEX_PIP = 7;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 11;
const MIDDLE_MCP = 9;
const RING_TIP = 16;
const RING_PIP = 15;
const PINKY_TIP = 20;
const PINKY_PIP = 19;

/** Tip–pip ratio above this (relative to hand scale) = finger extended. Hand-scale relative so it works when pointed up or down. */
const EXTENDED_RATIO = 0.22;
/** Tip–pip ratio below this = finger closed. */
const CLOSED_RATIO = 0.35;
/** Minimum hand scale (wrist–middle MCP) to avoid division by tiny values; fallback absolute thresholds if scale too small. */
const MIN_HAND_SCALE = 0.02;

/**
 * Normalize landmark to 0–1 space. x/y are 0–100 from our pipeline; z is optional (backend may send only x,y).
 */
function toNormalized(lm: { x: number; y: number; z?: number }) {
  return {
    x: lm.x / 100,
    y: lm.y / 100,
    z: lm.z ?? 0,
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

function tipPipDistance(
  landmarks: Array<{ x: number; y: number; z?: number }>,
  tipIdx: number,
  pipIdx: number
): number {
  if (landmarks.length <= Math.max(tipIdx, pipIdx)) return 0;
  return distance3d(toNormalized(landmarks[tipIdx]), toNormalized(landmarks[pipIdx]));
}

/** Hand scale = wrist to middle MCP distance (normalized). Makes ratios orientation-robust when pointed up or down. */
function handScale(landmarks: Array<{ x: number; y: number; z?: number }>): number {
  if (landmarks.length <= MIDDLE_MCP) return 0;
  return tipPipDistance(landmarks, WRIST, MIDDLE_MCP);
}

/**
 * Spider-Man / web-slinging gesture = thumb, index, and pinky extended; middle and ring closed.
 * Uses hand-scale-relative ratios so the same pose is recognized when the hand is pointed up or down.
 */
export function isHandInPhoneGesture(landmarks: Array<{ x: number; y: number; z?: number }>): boolean {
  if (landmarks.length <= PINKY_TIP) return false;

  const scale = handScale(landmarks);
  const useRatio = scale >= MIN_HAND_SCALE;

  const thumbDist = tipPipDistance(landmarks, THUMB_TIP, THUMB_IP);
  const indexDist = tipPipDistance(landmarks, INDEX_TIP, INDEX_PIP);
  const middleDist = tipPipDistance(landmarks, MIDDLE_TIP, MIDDLE_PIP);
  const ringDist = tipPipDistance(landmarks, RING_TIP, RING_PIP);
  const pinkyDist = tipPipDistance(landmarks, PINKY_TIP, PINKY_PIP);

  const thumbVal = useRatio ? thumbDist / scale : thumbDist;
  const indexVal = useRatio ? indexDist / scale : indexDist;
  const middleVal = useRatio ? middleDist / scale : middleDist;
  const ringVal = useRatio ? ringDist / scale : ringDist;
  const pinkyVal = useRatio ? pinkyDist / scale : pinkyDist;

  const extThr = useRatio ? EXTENDED_RATIO : 0.032;
  const closeThr = useRatio ? CLOSED_RATIO : 0.052;

  const thumbExtended = thumbVal > extThr;
  const indexExtended = indexVal > extThr;
  const middleClosed = middleVal < closeThr;
  const ringClosed = ringVal < closeThr;
  const pinkyExtended = pinkyVal > extThr;

  return thumbExtended && indexExtended && middleClosed && ringClosed && pinkyExtended;
}

export interface PhoneGestureState {
  leftPressed: boolean;
  rightPressed: boolean;
}

/**
 * Compute current phone-gesture state from hand data. Same shape as PinchState for drop-in use.
 */
export function computePhoneGestureState(hands: HandData | null): PhoneGestureState {
  const state: PhoneGestureState = { leftPressed: false, rightPressed: false };
  if (!hands?.hands?.length) return state;

  for (const hand of hands.hands) {
    const { landmarks, handedness } = hand;
    if (!handedness || landmarks.length <= PINKY_TIP) continue;
    const inPhonePose = isHandInPhoneGesture(landmarks);
    if (handedness === "Left") state.leftPressed = inPhonePose;
    else if (handedness === "Right") state.rightPressed = inPhonePose;
  }
  return state;
}
