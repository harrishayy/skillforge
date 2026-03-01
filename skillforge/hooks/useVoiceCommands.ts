"use client";
import { useRef, useCallback, useEffect, useState } from "react";
import {
  matchVoiceIntent,
  shouldUseLLMFallback,
} from "@/lib/voice-intent-matcher";
import { classifyVoiceIntent, transcribeAudio } from "@/lib/api-client";
import { showErrorToast } from "@/store/toast-store";

/* eslint-disable @typescript-eslint/no-explicit-any */
type SRInstance = any; // Vendor-prefixed SpeechRecognition lacks stable TS types

interface UseVoiceCommandsOptions {
  onNextStep: () => void;
  onFinish: () => void;
  onPreviousStep?: () => void;
  enabled?: boolean;
  useLLMFallback?: boolean;
  useFuzzy?: boolean;
  /**
   * "browser" — Web Speech API (default, runs in-browser via Chrome/Google).
   * "server"  — Records mic chunks and sends to the backend ASR endpoint
   *             (Brev-hosted NVIDIA Parakeet CTC 1.1B).
   */
  transcriptionSource?: "browser" | "server";
  /** Required when transcriptionSource is "server". */
  audioStream?: MediaStream | null;
}

const LLM_THROTTLE_MS = 2500;
const CHUNK_DURATION_MS = 2000;
const ASR_FAIL_THRESHOLD = 3;

export type VoiceStatus = "off" | "starting" | "listening" | "unavailable";

export function useVoiceCommands({
  onNextStep,
  onFinish,
  onPreviousStep,
  enabled = true,
  useLLMFallback = false,
  useFuzzy = true,
  transcriptionSource = "browser",
  audioStream = null,
}: UseVoiceCommandsOptions) {
  const transcriptRef = useRef<string>("");
  const stepTranscriptRef = useRef<string>("");
  const [isListening, setIsListening] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [fallbackActive, setFallbackActive] = useState(false);
  const asrFailCountRef = useRef(0);

  const onNextStepRef = useRef(onNextStep);
  const onFinishRef = useRef(onFinish);
  const onPreviousStepRef = useRef(onPreviousStep);
  const lastLLMCallRef = useRef(0);
  const lastCommandRef = useRef<number>(0);
  const COMMAND_COOLDOWN_MS = 2000;

  useEffect(() => { onNextStepRef.current = onNextStep; }, [onNextStep]);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);
  useEffect(() => { onPreviousStepRef.current = onPreviousStep; }, [onPreviousStep]);

  const effectiveSource = fallbackActive ? "browser" : transcriptionSource;

  useEffect(() => {
    if (!enabled) {
      setIsListening(false);
      return;
    }

    let active = true;
    stepTranscriptRef.current = "";

    // ── Shared intent matcher (used by both modes) ─────────────────────────
    const runMatcher = (check: string, hasFinal: boolean) => {
      const words = check.trim().split(/\s+/).filter(Boolean);
      if (words.length < 1) return;
      if (!hasFinal && words.length < 2) return;

      const intent = matchVoiceIntent(check, { useFuzzy });

      if (!intent && useLLMFallback && shouldUseLLMFallback(check)) {
        const now = Date.now();
        if (now - lastLLMCallRef.current >= LLM_THROTTLE_MS) {
          lastLLMCallRef.current = now;
          classifyVoiceIntent(check)
            .then((apiIntent) => {
              if (apiIntent === "none") return;
              if (apiIntent === "next") onNextStepRef.current();
              else if (apiIntent === "prev") onPreviousStepRef.current?.();
              else if (apiIntent === "finish") onFinishRef.current();
            })
            .catch((err: unknown) => showErrorToast(err));
          return;
        }
      }

      if (!intent) return;

      const now = Date.now();
      if (now - lastCommandRef.current < COMMAND_COOLDOWN_MS) return;
      lastCommandRef.current = now;

      if (intent === "next") onNextStepRef.current();
      else if (intent === "prev") onPreviousStepRef.current?.();
      else if (intent === "finish") onFinishRef.current();

      stepTranscriptRef.current = "";
      transcriptRef.current = "";
    };

    // ── Server ASR mode (Brev-hosted Parakeet CTC 1.1B) ───────────────────
    if (effectiveSource === "server") {
      if (!audioStream || !audioStream.active) {
        setUnavailableReason("No audio stream available for server transcription");
        return;
      }
      setUnavailableReason(null);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      let currentRecorder: MediaRecorder | null = null;

      const startChunk = () => {
        if (!active || !audioStream.active) return;
        try {
          const recorder = new MediaRecorder(audioStream, { mimeType });
          const chunks: Blob[] = [];

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = async () => {
            if (chunks.length === 0 || !active) return;
            const blob = new Blob(chunks, { type: mimeType });
            try {
              const transcript = await transcribeAudio(blob);
              asrFailCountRef.current = 0;
              if (!active || !transcript) return;
              stepTranscriptRef.current += transcript + " ";
              transcriptRef.current = stepTranscriptRef.current;
              runMatcher(transcript, true);
            } catch {
              asrFailCountRef.current += 1;
              if (asrFailCountRef.current >= ASR_FAIL_THRESHOLD && active) {
                console.warn(
                  `[ASR] ${ASR_FAIL_THRESHOLD} consecutive failures — falling back to browser Speech API`,
                );
                showErrorToast("Server ASR unavailable, switching to browser speech recognition");
                setFallbackActive(true);
              }
            }
          };

          recorder.start();
          currentRecorder = recorder;
          setIsListening(true);
        } catch (err) {
          console.warn("[ASR] MediaRecorder failed:", err);
          showErrorToast("Voice recording failed. Your browser may not support MediaRecorder.");
          setUnavailableReason("MediaRecorder not supported for audio");
        }
      };

      startChunk();

      const timer = setInterval(() => {
        if (!active) return;
        if (currentRecorder?.state === "recording") {
          currentRecorder.stop();
        }
        startChunk();
      }, CHUNK_DURATION_MS);

      return () => {
        active = false;
        clearInterval(timer);
        if (currentRecorder?.state === "recording") {
          try { currentRecorder.stop(); } catch (err) { console.warn("[ASR] Cleanup: MediaRecorder.stop() failed:", err); }
        }
        setIsListening(false);
      };
    }

    // ── Browser SpeechRecognition mode (default) ───────────────────────────
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setUnavailableReason("Voice commands require localhost or HTTPS. Open http://localhost:3000 instead.");
      console.warn("[VoiceCommands] Blocked: page is not a secure context. Use http://localhost:3000");
      showErrorToast("Voice commands unavailable — HTTPS is required. Use ngrok for secure access or open http://localhost:3000.");
      return;
    }

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setUnavailableReason("SpeechRecognition not supported in this browser.");
      return;
    }

    const recognition: SRInstance = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onaudiostart = () => setIsListening(true);

    recognition.onend = () => {
      if (active) {
        try { recognition.start(); } catch (err) { console.warn("[VoiceCommands] SpeechRecognition restart failed:", err); }
      }
    };

    recognition.onerror = (e: { error: string }) => {
      if (
        e.error === "not-allowed" ||
        e.error === "service-not-available" ||
        e.error === "audio-capture"
      ) {
        showErrorToast(`Voice recognition error: ${e.error}`);
        setIsListening(false);
        active = false;
      }
    };

    recognition.onresult = (event: any) => {
      let final = "";
      let hasFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        const isFinal = event.results[i].isFinal;
        if (isFinal) {
          final += text + " ";
          stepTranscriptRef.current += text + " ";
          hasFinal = true;
        }
      }

      transcriptRef.current = stepTranscriptRef.current;

      if (hasFinal) runMatcher(final.trim(), true);
    };

    const timer = setTimeout(() => {
      if (!active) return;
      try { recognition.start(); } catch (err) { console.warn("[VoiceCommands] SpeechRecognition initial start failed:", err); }
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
      try { recognition.stop(); } catch (err) { console.warn("[VoiceCommands] SpeechRecognition cleanup stop failed:", err); }
      setIsListening(false);
    };
  }, [enabled, useFuzzy, useLLMFallback, effectiveSource, audioStream, fallbackActive]);

  const snapshotTranscript = useCallback((): string => {
    const t = transcriptRef.current.trim();
    transcriptRef.current = "";
    stepTranscriptRef.current = "";
    return t;
  }, []);

  const status: VoiceStatus = unavailableReason
    ? "unavailable"
    : !enabled
      ? "off"
      : isListening
        ? "listening"
        : "starting";

  return { isListening, snapshotTranscript, status, unavailableReason, fallbackActive };
}
