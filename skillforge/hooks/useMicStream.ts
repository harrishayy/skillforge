"use client";

import { useEffect, useRef, useState } from "react";

interface UseMicStreamReturn {
  stream: MediaStream | null;
  error: string | null;
}

/**
 * Single owner of the microphone hardware.
 *
 * Mount once per page. Pass the returned stream into useWebcamRecorder.start()
 * so the recorder shares this mic rather than opening a second getUserMedia —
 * which conflicts with the browser's SpeechRecognition engine on macOS/Chrome.
 */
export function useMicStream(): UseMicStreamReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Microphone access denied");
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream, error };
}
