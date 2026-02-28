"use client";
import { motion, AnimatePresence } from "framer-motion";
import { msToTimestamp } from "@/lib/video-utils";
import { Button } from "@/components/ui/Button";

interface RecordingControlsProps {
  isRecording: boolean;
  isPaused: boolean;
  durationMs: number;
  currentStepNumber: number;
  stepPrompt: string;
  isLoadingPrompt?: boolean;
  onNextStep: () => void;
  onFinish: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function RecordingControls({
  isRecording,
  isPaused,
  durationMs,
  currentStepNumber,
  stepPrompt,
  isLoadingPrompt = false,
  onNextStep,
  onFinish,
  onPause,
  onResume,
}: RecordingControlsProps) {
  if (!isRecording) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <div
        className="rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: "var(--sf-black)", border: "1px solid #333" }}
      >
        {/* Step guidance prompt */}
        <div className="px-5 pt-4 pb-3" style={{ borderBottom: "1px solid #222" }}>
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
                    style={{ color: "var(--sf-white)" }}
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
              <Button size="sm" variant="secondary" onClick={onResume}>▶ Resume</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={onPause}>⏸ Pause</Button>
            )}
            <Button size="sm" variant="primary" onClick={onNextStep} disabled={isPaused}>→ Next Step</Button>
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
        <div className="px-5 pb-2">
          <p className="text-xs" style={{ color: "#555" }}>
            Say &ldquo;next step&rdquo; or &ldquo;done&rdquo; to advance hands-free
          </p>
        </div>
      </div>
    </div>
  );
}
