"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { showErrorToast } from "@/store/toast-store";

const CANVAS_W = 640;
const CANVAS_H = 360;
const CAPTURE_FPS = 24;

interface RemoteFrame {
  data: string; // base64 JPEG
  ts: number;
}

export interface PhoneVideoRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  durationMs: number;
  videoBlob: Blob | null;
  /** The canvas captureStream — attach to videoRef.srcObject to display phone frames */
  stream: MediaStream | null;
  /** Laptop mic stream — pass to useVoiceCommands */
  audioStream: MediaStream | null;
  error: string | null;
}

/**
 * Mirrors useWebcamRecorder exactly but records from phone JPEG frames instead
 * of a local webcam.
 *
 * Internally:
 *   - Maintains a 640×360 OffscreenCanvas (or regular canvas)
 *   - Draws each incoming remoteFrame to the canvas
 *   - Calls canvas.captureStream(24) for the video track
 *   - Gets laptop mic via getUserMedia({ audio, video:false }) for the audio track
 *   - Wraps MediaRecorder around both tracks
 *
 * The returned `stream` is the canvas captureStream — assign it to
 * videoRef.srcObject so the recording UI shows the phone feed.
 */
export function usePhoneVideoRecorder(
  remoteFrame: RemoteFrame | null,
  enabled: boolean
) {
  const [state, setState] = useState<PhoneVideoRecorderState>({
    isRecording: false,
    isPaused: false,
    durationMs: 0,
    videoBlob: null,
    stream: null,
    audioStream: null,
    error: null,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("video/webm");
  const stopResolveRef = useRef<((blob: Blob) => void) | null>(null);
  const isPausedRef = useRef(false);
  const pausedDurationRef = useRef(0);
  // Track the latest pending image load so out-of-order callbacks can be cancelled
  const pendingImgRef = useRef<HTMLImageElement | null>(null);

  // ---------------------------------------------------------------------------
  // Draw each incoming phone frame onto the canvas
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || !remoteFrame || !canvasRef.current) return;
    // Cancel any previous pending image decode
    if (pendingImgRef.current) pendingImgRef.current.onload = null;

    const img = new window.Image();
    pendingImgRef.current = img;
    img.onload = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      pendingImgRef.current = null;
    };
    img.src = `data:image/jpeg;base64,${remoteFrame.data}`;
  }, [remoteFrame, enabled]);

  // ---------------------------------------------------------------------------
  // Internal: start / restart MediaRecorder on an existing combined stream
  // ---------------------------------------------------------------------------
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

    recorder.start(1000); // collect data every 1 s
    mediaRecorderRef.current = recorder;
  }, []);

  // ---------------------------------------------------------------------------
  // start() — create canvas, get mic, start MediaRecorder
  // ---------------------------------------------------------------------------
  const start = useCallback(async (): Promise<MediaStream | null> => {
    try {
      // Create the canvas once; resize on every call in case it was recycled
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      canvasRef.current.width = CANVAS_W;
      canvasRef.current.height = CANVAS_H;

      const canvasStream = canvasRef.current.captureStream(CAPTURE_FPS);
      canvasStreamRef.current = canvasStream;

      // Get laptop mic (audio only — no second video permission prompt)
      let micStream: MediaStream | null = null;
      let hasAudio = false;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        micStreamRef.current = micStream;
        hasAudio = micStream.getAudioTracks().length > 0;
      } catch {
        // Mic permission denied — record video-only, voice commands will use
        // the laptop mic already acquired by webcamRecorder
        console.warn("[PhoneVideoRecorder] Mic permission denied — recording without audio");
      }

      // Combine canvas video track + mic audio track into the recording stream
      const recordingStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(micStream?.getAudioTracks() ?? []),
      ]);
      recordingStreamRef.current = recordingStream;

      const audioStream = hasAudio && micStream
        ? new MediaStream(micStream.getAudioTracks())
        : null;

      mimeTypeRef.current = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

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
        stream: canvasStream,
        audioStream,
        error: null,
        videoBlob: null,
        durationMs: 0,
      }));

      return canvasStream;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start phone recorder";
      showErrorToast(`Phone recorder error: ${msg}`);
      setState((s) => ({ ...s, error: msg }));
      return null;
    }
  }, [_startRecorderOnStream]);

  // ---------------------------------------------------------------------------
  // stop() — final recording; stops mic tracks, returns last blob
  // ---------------------------------------------------------------------------
  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        reject(new Error("No active phone recording"));
        return;
      }
      stopResolveRef.current = resolve;
      recorder.stop();

      // Release mic (not needed after recording ends)
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;

      // Stop the canvas captureStream tracks
      canvasStreamRef.current?.getTracks().forEach((t) => t.stop());
      canvasStreamRef.current = null;

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setState((s) => ({ ...s, isRecording: false, isPaused: false, audioStream: null }));
    });
  }, []);

  // ---------------------------------------------------------------------------
  // snapshot() — step boundary: stop recorder, get blob, restart on same stream
  // ---------------------------------------------------------------------------
  const snapshot = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      const recStream = recordingStreamRef.current;
      if (!recorder || recorder.state === "inactive" || !recStream) {
        reject(new Error("No active phone recording"));
        return;
      }
      // Restart the recorder on the same stream immediately after the blob resolves
      stopResolveRef.current = (blob) => {
        resolve(blob);
        _startRecorderOnStream(recStream);
      };
      recorder.stop();
    });
  }, [_startRecorderOnStream]);

  // ---------------------------------------------------------------------------
  // pause() / resume()
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // getDurationMs() — stable ref-based (no stale closure)
  // ---------------------------------------------------------------------------
  const getDurationMs = useCallback((): number => {
    if (isPausedRef.current) return pausedDurationRef.current;
    if (!startTimeRef.current) return 0;
    return Date.now() - startTimeRef.current;
  }, []);

  return { ...state, start, stop, pause, resume, snapshot, getDurationMs };
}
