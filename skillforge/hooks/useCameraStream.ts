"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseCameraStreamOptions {
  /** Video constraints passed to getUserMedia */
  constraints?: MediaTrackConstraints;
  /** Also request microphone access (needed for voice commands). Defaults to true. */
  audio?: boolean;
}

interface UseCameraStreamReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  isActive: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
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

  const { constraints = {}, audio = true } = options;

  // Attach stream after DOM update (video element only exists when isActive=true)
  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(console.error);
  }, [stream, isActive]);

  const start = useCallback(async () => {
    setError(null);
    try {
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 }, ...constraints },
          audio: audio ? { echoCancellation: true, noiseSuppression: true } : false,
        });
      } catch {
        // If audio+video fails, fall back to video-only
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 }, ...constraints },
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

  return { videoRef, stream, isActive, error, start, stop };
}
