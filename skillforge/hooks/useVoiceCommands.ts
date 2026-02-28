"use client";
import { useRef, useCallback, useEffect } from "react";
import {
  matchVoiceIntent,
  shouldUseLLMFallback,
} from "@/lib/voice-intent-matcher";
import { classifyVoiceIntent } from "@/lib/api-client";

interface UseVoiceCommandsOptions {
  onNextStep: () => void;
  onFinish: () => void;
  onPreviousStep?: () => void;
  enabled?: boolean;
  useLLMFallback?: boolean;
  useFuzzy?: boolean;
}

const LLM_THROTTLE_MS = 2500;

export function useVoiceCommands({
  onNextStep,
  onFinish,
  onPreviousStep,
  enabled = true,
  useLLMFallback = false,
  useFuzzy = true,
}: UseVoiceCommandsOptions) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef<string>("");
  const isActiveRef = useRef(false);
  const onNextStepRef = useRef(onNextStep);
  const onFinishRef = useRef(onFinish);
  const onPreviousStepRef = useRef(onPreviousStep);
  const lastLLMCallRef = useRef(0);

  useEffect(() => { onNextStepRef.current = onNextStep; }, [onNextStep]);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);
  useEffect(() => { onPreviousStepRef.current = onPreviousStep; }, [onPreviousStep]);

  const start = useCallback(() => {
    if (!enabled) return;
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onend = () => {
      if (isActiveRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    let stepTranscript = "";

    const runMatcher = (check: string, hasFinal: boolean) => {
      const words = check.trim().split(/\s+/).filter(Boolean);
      if (words.length < 1) return;
      if (!hasFinal && words.length < 2) return;

      let intent = matchVoiceIntent(check, { useFuzzy });

      if (!intent && useLLMFallback && shouldUseLLMFallback(check)) {
        const now = Date.now();
        if (now - lastLLMCallRef.current >= LLM_THROTTLE_MS) {
          lastLLMCallRef.current = now;
          classifyVoiceIntent(check).then((apiIntent) => {
            if (apiIntent === "none") return;
            if (apiIntent === "next") onNextStepRef.current();
            else if (apiIntent === "prev") onPreviousStepRef.current?.();
            else if (apiIntent === "finish") onFinishRef.current();
          }).catch(() => {});
          return;
        }
      }

      if (!intent) return;

      if (intent === "next") onNextStepRef.current();
      else if (intent === "prev") onPreviousStepRef.current?.();
      else if (intent === "finish") onFinishRef.current();

      stepTranscript = "";
      transcriptRef.current = "";
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      let hasFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        const isFinal = event.results[i].isFinal;
        if (isFinal) {
          final += text + " ";
          stepTranscript += text + " ";
          hasFinal = true;
        } else {
          interim = text;
        }
      }

      transcriptRef.current = stepTranscript;

      const check = (final + interim).toLowerCase().trim();
      if (check) runMatcher(check, hasFinal);
    };

    recognitionRef.current = recognition;
    isActiveRef.current = true;
    try { recognition.start(); } catch {}
  }, [enabled, useLLMFallback, useFuzzy]);

  const stop = useCallback(() => {
    isActiveRef.current = false;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
  }, []);

  const snapshotTranscript = useCallback((): string => {
    const t = transcriptRef.current.trim();
    transcriptRef.current = "";
    return t;
  }, []);

  return { start, stop, snapshotTranscript };
}
