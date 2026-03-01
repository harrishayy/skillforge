"use client";

import { useRef, useEffect } from "react";
import type { HandData } from "@/hooks/useLiveDetect";
import { computePhoneGestureState } from "@/lib/phone-gesture-detection";

/** Minimum ms between gesture-triggered actions (debounce). */
const GESTURE_DEBOUNCE_MS = 1000;

export interface UseDoubleTapDetectionOptions {
  onSkipForward: () => void;
  onSkipBackward: () => void;
}

/**
 * Detects Spider-Man / web-slinging gesture (thumb, index, pinky extended; middle, ring closed) per hand.
 * Right hand → onSkipForward; left hand → onSkipBackward.
 * Rising edge only: when hand transitions into pose, fire callback once. Debounced to one action per second.
 */
export function useDoubleTapDetection(
  hands: HandData | null,
  { onSkipForward, onSkipBackward }: UseDoubleTapDetectionOptions
) {
  const leftPrevRef = useRef(false);
  const rightPrevRef = useRef(false);
  const lastFiredAtRef = useRef(0);

  const onSkipForwardRef = useRef(onSkipForward);
  const onSkipBackwardRef = useRef(onSkipBackward);
  useEffect(() => {
    onSkipForwardRef.current = onSkipForward;
    onSkipBackwardRef.current = onSkipBackward;
  }, [onSkipForward, onSkipBackward]);

  const gesture = computePhoneGestureState(hands);

  useEffect(() => {
    const now = Date.now();
    const debounceOk = now - lastFiredAtRef.current >= GESTURE_DEBOUNCE_MS;

    if (debounceOk && !leftPrevRef.current && gesture.leftPressed) {
      lastFiredAtRef.current = now;
      onSkipBackwardRef.current();
    }
    leftPrevRef.current = gesture.leftPressed;

    if (debounceOk && !rightPrevRef.current && gesture.rightPressed) {
      lastFiredAtRef.current = now;
      onSkipForwardRef.current();
    }
    rightPrevRef.current = gesture.rightPressed;
  }, [gesture.leftPressed, gesture.rightPressed]);
}
