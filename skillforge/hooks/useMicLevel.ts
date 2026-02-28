"use client";

import { useCallback, useRef, useState } from "react";

interface UseMicLevelReturn {
  micLevel: number;   // 0–100
  hasMic: boolean;
  startMic: () => Promise<void>;
  stopMic: () => void;
}

/** Monitors microphone amplitude and exposes a 0–100 level value. */
export function useMicLevel(): UseMicLevelReturn {
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [hasMic, setHasMic] = useState(false);

  const startMic = useCallback(async () => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = ctx;
      setHasMic(true);

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setMicLevel(Math.min(100, (avg / 128) * 100));
        if (analyserRef.current) requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // mic not available
    }
  }, []);

  const stopMic = useCallback(() => {
    analyserRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setMicLevel(0);
    setHasMic(false);
  }, []);

  return { micLevel, hasMic, startMic, stopMic };
}
