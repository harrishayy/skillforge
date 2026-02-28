"use client";

import { motion, AnimatePresence } from "framer-motion";

export interface CompletedStep {
  stepNumber: number;
  durationMs: number;
}

interface StepHistoryPanelProps {
  visible: boolean;
  completedSteps: CompletedStep[];
  currentStepNumber: number;
}

const GLASS =
  "bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function StepHistoryPanel({
  visible,
  completedSteps,
  currentStepNumber,
}: StepHistoryPanelProps) {
  return (
    <div
      className={`fixed top-20 left-4 z-50 w-64 max-h-[calc(100vh-10rem)] overflow-y-auto transition-all duration-300 ${GLASS} ${
        visible
          ? "opacity-100 translate-x-0"
          : "opacity-0 -translate-x-8 pointer-events-none"
      }`}
    >
      <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <span className="text-sm font-bold text-white">Step Progress</span>
      </div>

      <div className="p-3 space-y-1">
        <AnimatePresence initial={false}>
          {completedSteps.map((step) => (
            <motion.div
              key={`done-${step.stepNumber}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
              style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: "var(--sf-lime)" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <span className="text-sm text-white font-medium">Step {step.stepNumber}</span>
              <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
                {formatDuration(step.durationMs)}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Current active step */}
        <motion.div
          key={`active-${currentStepNumber}`}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
          style={{ backgroundColor: "rgba(168, 85, 247, 0.2)", border: "1px solid rgba(168, 85, 247, 0.3)" }}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: "var(--sf-purple)" }}
          >
            <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
          </div>
          <span className="text-sm text-white font-bold">Step {currentStepNumber}</span>
          <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.5)" }}>
            recording...
          </span>
        </motion.div>
      </div>
    </div>
  );
}
