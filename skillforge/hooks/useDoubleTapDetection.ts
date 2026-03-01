"use client";

import { useRef, useEffect } from "react";
import type { HandData } from "@/hooks/useLiveDetect";
import { computePinchState } from "@/lib/pinch-detection";

/** Two taps within this window (ms) count as double-tap. */
const DOUBLE_TAP_WINDOW_MS = 400;

/** Sentinel: no previous tap in window. */
const NO_PREV_TAP = 0;

export interface UseDoubleTapDetectionOptions {
  onSkipForward: () => void;
  onSkipBackward: () => void;
}

/**
 * Detects double-tap (two quick index-thumb pinches with release in between) per hand.
 * Right hand double-tap → onSkipForward; left hand double-tap → onSkipBackward.
 * Uses release-to-retrigger: a press is when pinch goes from off to on.
 * Runs in useEffect to avoid setState-during-render.
 */
export function useDoubleTapDetection(
  hands: HandData | null,
  { onSkipForward, onSkipBackward }: UseDoubleTapDetectionOptions
) {
  const leftPinchPrevRef = useRef(false);
  const rightPinchPrevRef = useRef(false);
  const leftLastPressAtRef = useRef(0);
  const rightLastPressAtRef = useRef(0);

  const onSkipForwardRef = useRef(onSkipForward);
  const onSkipBackwardRef = useRef(onSkipBackward);
  useEffect(() => {
    onSkipForwardRef.current = onSkipForward;
    onSkipBackwardRef.current = onSkipBackward;
  }, [onSkipForward, onSkipBackward]);

  const pinch = computePinchState(hands);

  useEffect(() => {
    const now = Date.now();

    // Left hand: transition from !pressed to pressed = one press
    if (!leftPinchPrevRef.current && pinch.leftPressed) {
      const last = leftLastPressAtRef.current;
      if (last !== NO_PREV_TAP && now - last <= DOUBLE_TAP_WINDOW_MS) {
        onSkipBackwardRef.current();
        leftLastPressAtRef.current = NO_PREV_TAP;
      } else {
        leftLastPressAtRef.current = now;
      }
    }
    leftPinchPrevRef.current = pinch.leftPressed;

    // Right hand: same
    if (!rightPinchPrevRef.current && pinch.rightPressed) {
      const last = rightLastPressAtRef.current;
      if (last !== NO_PREV_TAP && now - last <= DOUBLE_TAP_WINDOW_MS) {
        onSkipForwardRef.current();
        rightLastPressAtRef.current = NO_PREV_TAP;
      } else {
        rightLastPressAtRef.current = now;
      }
    }
    rightPinchPrevRef.current = pinch.rightPressed;
  }, [pinch.leftPressed, pinch.rightPressed]);
}
