"use client";
import type { Step } from "@/types";
import { usePlayerStore } from "@/store/player-store";

interface StepProgressBarProps {
  steps: Step[];
  onStepClick?: (index: number) => void;
  onSubtaskClick?: (stepId: string, index: number) => void;
}

export function StepProgressBar({ steps, onStepClick, onSubtaskClick }: StepProgressBarProps) {
  const {
    currentStepIndex,
    stepProgress,
    isPlaying,
    subtasksByStep,
    currentSubtaskIndexByStep,
  } = usePlayerStore();

  const currentStep = steps[currentStepIndex] ?? null;
  const currentStepSubtasks = currentStep ? (subtasksByStep[currentStep.id] ?? []) : [];
  const currentSubtaskIndex = currentStep
    ? (currentSubtaskIndexByStep[currentStep.id] ?? 0)
    : 0;

  return (
    <div
      className="w-full flex flex-col gap-1.5 px-4 py-2"
      style={{ backgroundColor: "var(--sf-black)", borderBottom: "1px solid #222" }}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs shrink-0 mr-2" style={{ color: "#555" }}>
          Step {currentStepIndex + 1}/{steps.length}
        </span>
        <div className="flex items-center gap-1 flex-1">
          {steps.map((step, i) => {
            const isCompleted = i < currentStepIndex;
            const isCurrent = i === currentStepIndex;

            const fillPercent = isCompleted
              ? 100
              : isCurrent
              ? Math.round(stepProgress * 100)
              : 0;

            const fillColor = isCompleted
              ? "var(--sf-lime)"
              : isCurrent
              ? "var(--sf-purple)"
              : "transparent";

            return (
              <button
                key={step.id}
                title={step.title}
                onClick={() => onStepClick?.(i)}
                className="relative flex-1 group"
              >
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: "#2a2a2a" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${fillPercent}%`,
                      backgroundColor: fillColor,
                      transition: isPlaying
                        ? "width 250ms linear"
                        : "width 80ms ease-out",
                    }}
                  />
                </div>
                {isCurrent && (
                  <div
                    className="absolute -bottom-1 left-0 h-[2px] rounded-full transition-opacity duration-300"
                    style={{
                      width: `${fillPercent}%`,
                      backgroundColor: "var(--sf-purple)",
                      opacity: 0.3,
                      filter: "blur(3px)",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <span className="text-xs shrink-0 ml-2 max-w-48 truncate" style={{ color: "#888" }}>
          {currentStepSubtasks.length > 0
            ? currentStepSubtasks[currentSubtaskIndex]?.title ?? currentStep?.title
            : steps[currentStepIndex]?.title}
        </span>
      </div>
      {currentStep && currentStepSubtasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pl-0">
          {currentStepSubtasks.map((sub, idx) => {
            const isCurrentSub = idx === currentSubtaskIndex;
            return (
              <button
                key={idx}
                type="button"
                title={sub.description || sub.title}
                onClick={() => onSubtaskClick?.(currentStep.id, idx)}
                className="text-xs px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: isCurrentSub ? "var(--sf-purple)" : "transparent",
                  borderColor: isCurrentSub ? "var(--sf-purple)" : "#333",
                  color: isCurrentSub ? "var(--sf-black)" : "#888",
                }}
              >
                {sub.title}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
