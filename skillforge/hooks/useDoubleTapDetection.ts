"use client";

import { useRef, useEffect } from "react";
import type { HandData } from "@/hooks/useLiveDetect";
import { computePhoneGestureState } from "@/lib/phone-gesture-detection";

export interface UseDoubleTapDetectionOptions {
  onSkipForward: () => void;
  onSkipBackward: () => void;
}

/**
 * Detects Spider-Man / web-slinging gesture (thumb, index, pinky extended; middle, ring closed) per hand.
 * Right hand → onSkipForward; left hand → onSkipBackward.
 * Rising edge only: when hand transitions into phone pose, fire callback once.
 */
export function useDoubleTapDetection(
  hands: HandData | null,
  { onSkipForward, onSkipBackward }: UseDoubleTapDetectionOptions
) {
  const leftPrevRef = useRef(false);
  const rightPrevRef = useRef(false);

  const onSkipForwardRef = useRef(onSkipForward);
  const onSkipBackwardRef = useRef(onSkipBackward);
  useEffect(() => {
    onSkipForwardRef.current = onSkipForward;
    onSkipBackwardRef.current = onSkipBackward;
  }, [onSkipForward, onSkipBackward]);

  const gesture = computePhoneGestureState(hands);

  useEffect(() => {
    if (!leftPrevRef.current && gesture.leftPressed) {
      onSkipBackwardRef.current();
    }
    leftPrevRef.current = gesture.leftPressed;

    if (!rightPrevRef.current && gesture.rightPressed) {
      onSkipForwardRef.current();
    }
    rightPrevRef.current = gesture.rightPressed;
  }, [gesture.leftPressed, gesture.rightPressed]);
}
