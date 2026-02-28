"use client";

import { motion, AnimatePresence } from "framer-motion";
import { msToTimestamp } from "@/lib/video-utils";
import type { VoiceStatus } from "@/hooks/useVoiceCommands";

interface SessionControlBarProps {
  isPaused: boolean;
  durationMs: number;
  currentStepNumber: number;
  stepPrompt: string;
  isLoadingPrompt?: boolean;
  micEnabled: boolean;
  isListening: boolean;
  voiceStatus: VoiceStatus;
  voiceUnavailableReason?: string | null;
  onNextStep: () => void;
  onFinish: () => void;
  onPause: () => void;
  onResume: () => void;
  onToggleMic: () => void;
}

const GLASS =
  "bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50";

export function SessionControlBar({
  isPaused,
  durationMs,
  currentStepNumber,
  stepPrompt,
  isLoadingPrompt = false,
  micEnabled,
  isListening,
  voiceStatus,
  voiceUnavailableReason,
  onNextStep,
  onFinish,
  onPause,
  onResume,
  onToggleMic,
}: SessionControlBarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <div className={GLASS} style={{ overflow: "hidden" }}>
        {/* Step guidance prompt */}
        <div className="px-5 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-start gap-2">
            <span
              className="text-xs font-black uppercase tracking-wider mt-0.5 shrink-0 px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
            >
              Step {currentStepNumber}
            </span>
            <div className="flex-1 min-h-5">
              <AnimatePresence mode="wait">
                {isLoadingPrompt ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:300ms]" />
                  </motion.div>
                ) : (
                  <motion.p
                    key={stepPrompt}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="text-sm leading-snug"
                    style={{ color: "rgba(255,255,255,0.9)" }}
                  >
                    {stepPrompt || "Speak and demonstrate this step..."}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Controls bar */}
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-mono shrink-0" style={{ color: "var(--sf-white)" }}>
            <span className={`w-2.5 h-2.5 rounded-full bg-red-500 ${isPaused ? "" : "animate-pulse"}`} />
            {isPaused ? "PAUSED" : "REC"}&nbsp;{msToTimestamp(durationMs)}
          </span>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            {isPaused ? (
              <button
                onClick={onResume}
                className="text-xs font-bold px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80"
                style={{ backgroundColor: "rgba(255,255,255,0.12)", color: "var(--sf-white)" }}
              >
                ▶ Resume
              </button>
            ) : (
              <button
                onClick={onPause}
                className="text-xs font-bold px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80"
                style={{ backgroundColor: "rgba(255,255,255,0.12)", color: "var(--sf-white)" }}
              >
                ⏸ Pause
              </button>
            )}
            <button
              onClick={onNextStep}
              disabled={isPaused}
              className="text-xs font-bold px-4 py-1.5 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-30"
              style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
            >
              → Next Step
            </button>
            <button
              onClick={onFinish}
              className="text-xs font-bold px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--sf-orange)", color: "var(--sf-black)" }}
            >
              ■ Finish
            </button>
          </div>
        </div>

        {/* Voice hint */}
        <div className="px-5 pb-2.5 flex items-center justify-between">
          <p className="text-xs" style={{ color: voiceStatus === "unavailable" ? "rgba(239,68,68,0.7)" : "rgba(255,255,255,0.3)" }}>
            {voiceStatus === "unavailable"
              ? (voiceUnavailableReason ?? "Voice commands unavailable")
              : micEnabled
                ? <>Say &ldquo;next step&rdquo; or double-tap pinch to advance &middot; Say &ldquo;finish recording&rdquo; to end</>
                : <>Voice commands muted &middot; Double-tap pinch to advance</>
            }
          </p>
          {voiceStatus !== "unavailable" && (
            <button
              onClick={onToggleMic}
              className="flex items-center gap-1 text-xs font-bold rounded-lg px-2 py-1 transition-all hover:scale-105 shrink-0 ml-3"
              style={{
                backgroundColor: micEnabled && isListening
                  ? "rgba(190, 242, 100, 0.15)"
                  : "rgba(255, 255, 255, 0.06)",
                color: micEnabled && isListening
                  ? "var(--sf-lime)"
                  : "rgba(255,255,255,0.4)",
              }}
              title={micEnabled ? "Mute voice commands" : "Unmute voice commands"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {micEnabled ? (
                  <>
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </>
                ) : (
                  <>
                    <line x1="2" x2="22" y1="2" y2="22" />
                    <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                    <path d="M5 10v2a7 7 0 0 0 12 0" />
                    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </>
                )}
              </svg>
              {micEnabled ? (isListening ? "On" : "...") : "Off"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
