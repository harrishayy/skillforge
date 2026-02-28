"use client";
import { useRef, useCallback, useEffect, useState } from "react";
import {
  matchVoiceIntent,
  shouldUseLLMFallback,
} from "@/lib/voice-intent-matcher";
import { classifyVoiceIntent } from "@/lib/api-client";
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
}

const LLM_THROTTLE_MS = 2500;

export type VoiceStatus = "off" | "starting" | "listening" | "unavailable";

export function useVoiceCommands({
  onNextStep,
  onFinish,
  onPreviousStep,
  enabled = true,
  useLLMFallback = false,
  useFuzzy = true,
}: UseVoiceCommandsOptions) {
  const transcriptRef = useRef<string>("");
  const [isListening, setIsListening] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string>("");

  const onNextStepRef = useRef(onNextStep);
  const onFinishRef = useRef(onFinish);
  const onPreviousStepRef = useRef(onPreviousStep);
  const lastLLMCallRef = useRef(0);
  const lastCommandRef = useRef<number>(0);
  const COMMAND_COOLDOWN_MS = 2000;

  useEffect(() => { onNextStepRef.current = onNextStep; }, [onNextStep]);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);
  useEffect(() => { onPreviousStepRef.current = onPreviousStep; }, [onPreviousStep]);

  useEffect(() => {
    if (!enabled) {
      setIsListening(false);
      return;
    }

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setUnavailableReason("Voice commands require localhost or HTTPS. Open http://localhost:3000 instead.");
      console.warn("[VoiceCommands] Blocked: page is not a secure context. Use http://localhost:3000");
      return;
    }

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setUnavailableReason("SpeechRecognition not supported in this browser.");
      return;
    }

    let active = true;
    let stepTranscript = "";
    const recognition: SRInstance = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onaudiostart = () => setIsListening(true);

    recognition.onend = () => {
      if (active) {
        try { recognition.start(); } catch {}
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

      // Cooldown: ignore commands fired within 2s of the last one
      const now = Date.now();
      if (now - lastCommandRef.current < COMMAND_COOLDOWN_MS) return;
      lastCommandRef.current = now;

      if (intent === "next") onNextStepRef.current();
      else if (intent === "prev") onPreviousStepRef.current?.();
      else if (intent === "finish") onFinishRef.current();

      stepTranscript = "";
      transcriptRef.current = "";
    };

    recognition.onresult = (event: any) => {
      let final = "";
      let hasFinal = false;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        const isFinal = event.results[i].isFinal;
        if (isFinal) {
          final += text + " ";
          stepTranscript += text + " ";
          hasFinal = true;
        } else {
          interim += text + " ";
        }
      }

      transcriptRef.current = stepTranscript;
      setLiveTranscript((stepTranscript + interim).trim());

      // Only run the command matcher on finalised results — ignoring interim
      // transcripts prevents ambient speech and partial phrases from triggering
      // commands prematurely.
      if (hasFinal) runMatcher(final.trim(), true);
    };

    // Small delay so React Strict Mode's first-pass cleanup finishes before
    // we call start(). Chrome only allows one SpeechRecognition at a time.
    const timer = setTimeout(() => {
      if (!active) return;
      try { recognition.start(); } catch {}
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
      try { recognition.stop(); } catch {}
      setIsListening(false);
    };
  }, [enabled, useFuzzy, useLLMFallback]);

  const snapshotTranscript = useCallback((): string => {
    const t = transcriptRef.current.trim();
    transcriptRef.current = "";
    setLiveTranscript("");
    return t;
  }, []);

  const status: VoiceStatus = unavailableReason
    ? "unavailable"
    : !enabled
      ? "off"
      : isListening
        ? "listening"
        : "starting";

  return { isListening, snapshotTranscript, status, unavailableReason, liveTranscript };
}
