"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FacingMode = "user" | "environment";

interface UseCameraStreamOptions {
  /** Video constraints passed to getUserMedia */
  constraints?: MediaTrackConstraints;
  /** Also request microphone access (needed for voice commands). Defaults to true. */
  audio?: boolean;
  /** Preferred camera facing (front "user" or back "environment"). Used when starting and when switching. */
  facingMode?: FacingMode;
}

interface UseCameraStreamReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  isActive: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** Switch between front and back camera. Stops current stream and starts with the other facingMode. */
  switchCamera: () => void;
  facingMode: FacingMode;
}

/**
 * Manages a camera stream lifecycle.
 * Attaches stream to videoRef via useEffect so the video element
 * is guaranteed to be in the DOM when srcObject is set.
 */
export function useCameraStream(
  options: UseCameraStreamOptions = {}
): UseCameraStreamReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facingModeRef = useRef<FacingMode>(options.facingMode ?? "user");
  const [facingMode, setFacingMode] = useState<FacingMode>(options.facingMode ?? "user");

  const { constraints = {}, audio = true } = options;

  // Attach stream after DOM update (video element only exists when isActive=true)
  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(console.error);
  }, [stream, isActive]);

  const start = useCallback(async () => {
    setError(null);
    const mode = facingModeRef.current;
    try {
      let mediaStream: MediaStream;
      const videoConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
        facingMode: { ideal: mode },
        ...constraints,
      };
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: audio ? { echoCancellation: true, noiseSuppression: true } : false,
        });
      } catch {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      }
      setStream(mediaStream);
      setIsActive(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Camera access denied");
    }
  }, [constraints, audio]);

  const stop = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setIsActive(false);
  }, [stream]);

  const switchCamera = useCallback(() => {
    const next = facingModeRef.current === "user" ? "environment" : "user";
    facingModeRef.current = next;
    setFacingMode(next);
    stop();
    start();
  }, [stop, start]);

  return { videoRef, stream, isActive, error, start, stop, switchCamera, facingMode };
}
