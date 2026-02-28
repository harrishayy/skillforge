"use client";
import { useRef, useCallback, useEffect } from "react";

const NEXT_STEP_PHRASES = ["next step", "next", "continue", "moving on", "done with this"];
const FINISH_PHRASES = ["finish", "done", "complete", "that's it", "end recording", "stop recording"];

interface UseVoiceCommandsOptions {
  onNextStep: () => void;
  onFinish: () => void;
  enabled?: boolean;
}

export function useVoiceCommands({ onNextStep, onFinish, enabled = true }: UseVoiceCommandsOptions) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef<string>("");
  const isActiveRef = useRef(false);
  const onNextStepRef = useRef(onNextStep);
  const onFinishRef = useRef(onFinish);

  // Keep refs in sync without restarting recognition
  useEffect(() => { onNextStepRef.current = onNextStep; }, [onNextStep]);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

  const start = useCallback(() => {
    if (!enabled) return;
    const SpeechRecognition =
      (window as typeof window & { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ??
      (window as typeof window & { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) return; // graceful no-op if API unavailable

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let stepTranscript = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        if (event.results[i].isFinal) {
          final += text + " ";
          stepTranscript += text + " ";
        } else {
          interim = text;
        }
      }

      transcriptRef.current = stepTranscript;

      const check = (final + interim).toLowerCase();
      if (NEXT_STEP_PHRASES.some((p) => check.includes(p))) {
        onNextStepRef.current();
        // Reset step transcript after advancing
        stepTranscript = "";
        transcriptRef.current = "";
      } else if (FINISH_PHRASES.some((p) => check.includes(p))) {
        onFinishRef.current();
      }
    };

    recognition.onend = () => {
      // Auto-restart if still active (browser stops after silence)
      if (isActiveRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    isActiveRef.current = true;
    try { recognition.start(); } catch {}
  }, [enabled]);

  const stop = useCallback(() => {
    isActiveRef.current = false;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
  }, []);

  /** Call this when advancing to next step to capture current step's transcript */
  const snapshotTranscript = useCallback((): string => {
    const t = transcriptRef.current.trim();
    transcriptRef.current = "";
    return t;
  }, []);

  return { start, stop, snapshotTranscript };
}
