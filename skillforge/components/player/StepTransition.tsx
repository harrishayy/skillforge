"use client";
import { useEffect, useState } from "react";
import type { Step } from "@/types";

interface StepTransitionProps {
  completedStep: Step;
  nextStep: Step | null;
  currentIndex: number;
  totalSteps: number;
  onContinue: () => void;
}

const AUTO_ADVANCE_MS = 8000;
const RING_SIZE = 48;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function StepTransition({
  completedStep,
  nextStep,
  currentIndex,
  totalSteps,
  onContinue,
}: StepTransitionProps) {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_ADVANCE_MS);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    if (!nextStep) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const remaining = Math.max(0, AUTO_ADVANCE_MS - elapsed);
      setCountdown(remaining);
      if (remaining <= 0) {
        onContinue();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nextStep, onContinue]);

  const progress = nextStep ? 1 - countdown / AUTO_ADVANCE_MS : 1;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 400ms ease-out",
      }}
    >
      <div
        className="flex flex-col items-center gap-6 px-10 py-8 rounded-2xl max-w-md w-full sf-transition-card"
        style={{
          backgroundColor: "#111",
          border: "1px solid #2a2a2a",
          transform: visible ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
          opacity: visible ? 1 : 0,
          transition: "transform 500ms cubic-bezier(.16,1,.3,1), opacity 400ms ease-out",
        }}
      >
        {/* Completed step badge */}
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3.5 8.5L6.5 11.5L12.5 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--sf-lime)" }}>
              Step {currentIndex + 1} complete
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>
              {completedStep.title}
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="w-full flex items-center gap-3">
          <div className="flex-1 h-px" style={{ backgroundColor: "#2a2a2a" }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#333" }} />
          <div className="flex-1 h-px" style={{ backgroundColor: "#2a2a2a" }} />
        </div>

        {nextStep ? (
          <>
            {/* Next step preview */}
            <div className="text-center">
              <p className="text-xs font-medium mb-1" style={{ color: "#666" }}>
                Up next — Step {currentIndex + 2} of {totalSteps}
              </p>
              <p className="text-lg font-bold" style={{ color: "var(--sf-white)" }}>
                {nextStep.title}
              </p>
              {nextStep.description && (
                <p
                  className="text-xs mt-2 leading-relaxed max-w-xs mx-auto"
                  style={{ color: "#888" }}
                >
                  {nextStep.description.slice(0, 120)}
                  {nextStep.description.length > 120 ? "…" : ""}
                </p>
              )}
            </div>

            {/* Continue button with countdown ring */}
            <button
              onClick={onContinue}
              className="group relative flex items-center gap-3 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200"
              style={{
                backgroundColor: "var(--sf-purple)",
                color: "var(--sf-white)",
                border: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.85";
                e.currentTarget.style.transform = "scale(1.02)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              <span>Continue</span>
              <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
                <svg
                  width={RING_SIZE}
                  height={RING_SIZE}
                  className="absolute inset-0 -rotate-90"
                >
                  <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth={RING_STROKE}
                  />
                  <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--sf-white)"
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    style={{ transition: "stroke-dashoffset 100ms linear" }}
                  />
                </svg>
                <span
                  className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold"
                  style={{ color: "var(--sf-white)" }}
                >
                  {Math.ceil(countdown / 1000)}
                </span>
              </div>
            </button>
          </>
        ) : (
          <>
            {/* All steps finished */}
            <div className="text-center">
              <p className="text-lg font-bold" style={{ color: "var(--sf-lime)" }}>
                All steps complete!
              </p>
              <p className="text-xs mt-1" style={{ color: "#666" }}>
                Great work — you&apos;ve finished the entire workflow.
              </p>
            </div>
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center sf-transition-confetti"
              style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12L10 17L20 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
