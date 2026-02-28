"use client";
import type { Step } from "@/types";
import { usePlayerStore } from "@/store/player-store";

interface StepProgressBarProps {
  steps: Step[];
  onStepClick?: (index: number) => void;
}

export function StepProgressBar({ steps, onStepClick }: StepProgressBarProps) {
  const { currentStepIndex } = usePlayerStore();

  return (
    <div
      className="w-full flex items-center gap-1 px-4 py-2"
      style={{ backgroundColor: "var(--sf-black)", borderBottom: "1px solid #222" }}
    >
      <span className="text-xs shrink-0 mr-2" style={{ color: "#555" }}>
        Step {currentStepIndex + 1}/{steps.length}
      </span>
      <div className="flex items-center gap-1 flex-1">
        {steps.map((step, i) => (
          <button
            key={step.id}
            title={step.title}
            onClick={() => onStepClick?.(i)}
            className="relative flex-1 group"
          >
            <div
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                backgroundColor: i < currentStepIndex
                  ? "var(--sf-lime)"
                  : i === currentStepIndex
                  ? "var(--sf-purple)"
                  : "#2a2a2a",
                opacity: i === currentStepIndex ? 1 : undefined,
              }}
            />
          </button>
        ))}
      </div>
      <span className="text-xs shrink-0 ml-2 max-w-48 truncate" style={{ color: "#888" }}>
        {steps[currentStepIndex]?.title}
      </span>
    </div>
  );
}
