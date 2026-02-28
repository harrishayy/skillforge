"use client";
import { useState, useRef, useCallback } from "react";

export interface WebcamRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  durationMs: number;
  videoBlob: Blob | null;
  stream: MediaStream | null;
  error: string | null;
}

export function useWebcamRecorder() {
  const [state, setState] = useState<WebcamRecorderState>({
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
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("video/webm");
  const stopResolveRef = useRef<((blob: Blob) => void) | null>(null);

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
      let stream: MediaStream;
      const videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

      // Request video + audio for recording. Audio captures speech during steps;
      // the same mic feeds voice commands (SpeechRecognition) and the video file.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      }

      // Record video + audio (full stream) so saved videos include speech.
      const recordingStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...stream.getAudioTracks(),
      ]);

      mimeTypeRef.current = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      streamRef.current = stream;
      recordingStreamRef.current = recordingStream;
      _startRecorderOnStream(recordingStream);

      startTimeRef.current = Date.now();
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
      return stream;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      setState((s) => ({ ...s, error: msg }));
      return null;
    }
  }, [_startRecorderOnStream]);

  /**
   * Fully stop recording and release the camera.
   * Returns a Promise that resolves with the final video Blob.
   */
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
      setState((s) => ({ ...s, isRecording: false, isPaused: false }));
    });
  }, []);

  /**
   * Finalize the current segment as a Blob and immediately restart
   * recording on the same camera stream (no visible interruption).
   * Used to capture per-step video segments without stopping the camera.
   */
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

  return { ...state, start, stop, pause, resume, snapshot };
}
