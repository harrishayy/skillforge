"use client";
import { useState, useRef, useCallback } from "react";
import { showErrorToast } from "@/store/toast-store";

export interface ScreenRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  durationMs: number;
  videoBlob: Blob | null;
  stream: MediaStream | null;
  error: string | null;
}

export function useScreenRecorder() {
  const [state, setState] = useState<ScreenRecorderState>({
    isRecording: false,
    isPaused: false,
    durationMs: 0,
    videoBlob: null,
    stream: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setState((s) => ({ ...s, videoBlob: blob, isRecording: false, isPaused: false }));
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
      };

      recorder.start(1000); // collect data every second
      startTimeRef.current = Date.now();
      mediaRecorderRef.current = recorder;

      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, durationMs: Date.now() - startTimeRef.current }));
      }, 500);

      setState((s) => ({
        ...s,
        isRecording: true,
        isPaused: false,
        stream,
        error: null,
        videoBlob: null,
        durationMs: 0,
      }));

      // Handle user stopping from browser UI
      stream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current?.state !== "inactive") {
          mediaRecorderRef.current?.stop();
        }
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Screen capture denied";
      showErrorToast(`Screen capture error: ${msg}`);
      setState((s) => ({ ...s, error: msg }));
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      setState((s) => ({ ...s, isPaused: true }));
    }
  }, []);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      const pausedAt = state.durationMs;
      startTimeRef.current = Date.now() - pausedAt;
      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, durationMs: Date.now() - startTimeRef.current }));
      }, 500);
      setState((s) => ({ ...s, isPaused: false }));
    }
  }, [state.durationMs]);

  return { ...state, start, stop, pause, resume };
}
