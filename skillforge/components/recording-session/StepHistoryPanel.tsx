"use client";

import { motion, AnimatePresence } from "framer-motion";

export interface CompletedStep {
  stepNumber: number;
  durationMs: number;
}

interface ApparatusShowcaseState {
  active: boolean;
  phase: "overview" | "individual";
  objectCount: number;
}

interface StepHistoryPanelProps {
  visible: boolean;
  completedSteps: CompletedStep[];
  currentStepNumber: number;
  editingStepNumber?: number | null;
  onStepClick?: (stepNumber: number) => void;
  apparatus?: ApparatusShowcaseState;
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
  editingStepNumber,
  onStepClick,
  apparatus,
}: StepHistoryPanelProps) {
  const isApparatusActive = apparatus?.active ?? false;

  return (
    <div
      className={`fixed top-20 left-4 z-50 w-64 max-h-[calc(100vh-10rem)] overflow-y-auto transition-all duration-300 ${GLASS} ${
        visible
          ? "opacity-100 translate-x-0"
          : "opacity-0 -translate-x-8 pointer-events-none"
      }`}
    >
      <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <span className="text-sm font-bold text-white">
          {isApparatusActive ? "Apparatus Showcase" : "Step Progress"}
        </span>
      </div>

      <div className="p-3 space-y-1">
        {/* Apparatus showcase progress */}
        {isApparatusActive && apparatus && (
          <div className="space-y-1 mb-2">
            {/* Overview phase row */}
            <div
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
              style={{
                backgroundColor: apparatus.phase === "overview"
                  ? "rgba(245,158,11,0.2)"
                  : "rgba(255,255,255,0.05)",
                border: apparatus.phase === "overview"
                  ? "1px solid rgba(245,158,11,0.3)"
                  : "1px solid transparent",
              }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: apparatus.phase === "overview"
                    ? "var(--sf-yellow)"
                    : "var(--sf-lime)",
                }}
              >
                {apparatus.phase === "overview" ? (
                  <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>
              <span className="text-sm text-white font-medium">All Objects</span>
              <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
                {apparatus.phase === "overview" ? "recording..." : "done"}
              </span>
            </div>

            {/* Completed individual objects */}
            {apparatus.phase === "individual" && apparatus.objectCount > 1 && (
              <AnimatePresence initial={false}>
                {Array.from({ length: apparatus.objectCount - 1 }, (_, i) => (
                  <motion.div
                    key={`obj-done-${i + 1}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid transparent",
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: "var(--sf-lime)" }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                    <span className="text-sm text-white font-medium">Object {i + 1}</span>
                    <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
                      done
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}

            {/* Current individual object */}
            {apparatus.phase === "individual" && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                style={{
                  backgroundColor: "rgba(245,158,11,0.2)",
                  border: "1px solid rgba(245,158,11,0.3)",
                }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "var(--sf-yellow)" }}
                >
                  <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
                </div>
                <span className="text-sm text-white font-medium">Object {apparatus.objectCount}</span>
                <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
                  recording...
                </span>
              </motion.div>
            )}

            {/* Divider before step list */}
            <div className="pt-1 pb-0.5">
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {completedSteps.map((step) => {
            const isEditing = editingStepNumber === step.stepNumber;
            return (
              <motion.button
                key={`done-${step.stepNumber}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => onStepClick?.(step.stepNumber)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors text-left"
                style={{
                  backgroundColor: isEditing
                    ? "rgba(245, 158, 11, 0.15)"
                    : "rgba(255,255,255,0.05)",
                  border: isEditing
                    ? "1px solid rgba(245, 158, 11, 0.3)"
                    : "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: isEditing ? "var(--sf-yellow)" : "var(--sf-lime)" }}
                >
                  {isEditing ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-white font-medium">Step {step.stepNumber}</span>
                <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {isEditing ? "editing notes" : formatDuration(step.durationMs)}
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>

        {/* Current active step */}
        <motion.button
          key={`active-${currentStepNumber}`}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => onStepClick?.(currentStepNumber)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left"
          style={{
            backgroundColor: isApparatusActive
              ? "rgba(255,255,255,0.05)"
              : editingStepNumber === currentStepNumber || !editingStepNumber
                ? "rgba(168, 85, 247, 0.2)"
                : "rgba(168, 85, 247, 0.1)",
            border: isApparatusActive
              ? "1px solid rgba(255,255,255,0.08)"
              : "1px solid rgba(168, 85, 247, 0.3)",
            cursor: "pointer",
          }}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{
              backgroundColor: isApparatusActive
                ? "rgba(255,255,255,0.15)"
                : "var(--sf-purple)",
            }}
          >
            {isApparatusActive ? (
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.3)" }} />
            ) : (
              <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
            )}
          </div>
          <span className={`text-sm font-bold ${isApparatusActive ? "text-white/40" : "text-white"}`}>
            Step {currentStepNumber}
          </span>
          <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
            {isApparatusActive ? "up next" : "recording..."}
          </span>
        </motion.button>
      </div>
    </div>
  );
}
