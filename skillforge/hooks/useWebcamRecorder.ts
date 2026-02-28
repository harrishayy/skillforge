"use client";
import { useState, useRef, useCallback } from "react";
import { showErrorToast } from "@/store/toast-store";

export interface WebcamRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  durationMs: number;
  videoBlob: Blob | null;
  stream: MediaStream | null;
  audioStream: MediaStream | null;
  error: string | null;
}

export function useWebcamRecorder() {
  const [state, setState] = useState<WebcamRecorderState>({
    isRecording: false,
    isPaused: false,
    durationMs: 0,
    videoBlob: null,
    stream: null,
    audioStream: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("video/webm");
  const stopResolveRef = useRef<((blob: Blob) => void) | null>(null);
  const isPausedRef = useRef(false);
  const pausedDurationRef = useRef(0);

  const _startRecorderOnStream = useCallback((stream: MediaStream) => {
    const mimeType = mimeTypeRef.current;
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (stopResolveRef.current) {
        stopResolveRef.current(blob);
        stopResolveRef.current = null;
      }
      setState((s) => ({ ...s, videoBlob: blob }));
    };

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
  }, []);

  const start = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

      let stream: MediaStream;
      let hasAudio = false;

      try {
        // Single getUserMedia for both camera + mic → one browser permission prompt.
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: audioConstraints,
        });
        hasAudio = stream.getAudioTracks().length > 0;
      } catch {
        // If audio+video fails, try video-only so recording can still proceed.
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      }

      const recordingStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...stream.getAudioTracks(),
      ]);

      // Expose a standalone audio stream so SpeechRecognition can reference it
      // for diagnostics. SpeechRecognition uses its own internal mic capture,
      // but having audio tracks in the same getUserMedia call avoids the
      // dual-capture conflict on macOS/Chrome.
      const audioStream = hasAudio
        ? new MediaStream(stream.getAudioTracks())
        : null;

      mimeTypeRef.current = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      streamRef.current = stream;
      recordingStreamRef.current = recordingStream;
      _startRecorderOnStream(recordingStream);

      isPausedRef.current = false;
      pausedDurationRef.current = 0;
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, durationMs: Date.now() - startTimeRef.current }));
      }, 500);

      setState((s) => ({
        ...s,
        isRecording: true,
        isPaused: false,
        stream,
        audioStream,
        error: null,
        videoBlob: null,
        durationMs: 0,
      }));
      return stream;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      showErrorToast(`Camera error: ${msg}`);
      setState((s) => ({ ...s, error: msg }));
      return null;
    }
  }, [_startRecorderOnStream]);

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        reject(new Error("No active recording"));
        return;
      }
      stopResolveRef.current = resolve;
      recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recordingStreamRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      setState((s) => ({ ...s, isRecording: false, isPaused: false, audioStream: null }));
    });
  }, []);

  const snapshot = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      const recStream = recordingStreamRef.current;
      if (!recorder || recorder.state === "inactive" || !recStream) {
        reject(new Error("No active recording"));
        return;
      }
      stopResolveRef.current = (blob) => {
        resolve(blob);
        _startRecorderOnStream(recStream);
      };
      recorder.stop();
    });
  }, [_startRecorderOnStream]);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      isPausedRef.current = true;
      pausedDurationRef.current = Date.now() - startTimeRef.current;
      setState((s) => ({ ...s, isPaused: true, durationMs: pausedDurationRef.current }));
    }
  }, []);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now() - pausedDurationRef.current;
      isPausedRef.current = false;
      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, durationMs: Date.now() - startTimeRef.current }));
      }, 500);
      setState((s) => ({ ...s, isPaused: false }));
    }
  }, []);

  const getDurationMs = useCallback((): number => {
    if (isPausedRef.current) return pausedDurationRef.current;
    if (!startTimeRef.current) return 0;
    return Date.now() - startTimeRef.current;
  }, []);

  return { ...state, start, stop, pause, resume, snapshot, getDurationMs };
}
