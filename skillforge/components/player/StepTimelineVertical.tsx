"use client";
import type { Step, Subtask } from "@/types";
import { usePlayerStore } from "@/store/player-store";

interface StepTimelineVerticalProps {
  steps: Step[];
  onStepClick?: (index: number) => void;
  onSubtaskClick?: (stepId: string, index: number) => void;
}

const NODE_SIZE = 10;
const LINE_WIDTH = 2;
const TRACK_WIDTH = 20;

export function StepTimelineVertical({
  steps,
  onStepClick,
  onSubtaskClick,
}: StepTimelineVerticalProps) {
  const {
    currentStepIndex,
    subtasksByStep,
    currentSubtaskIndexByStep,
  } = usePlayerStore();

  return (
    <div
      className="flex flex-col py-3 overflow-y-auto shrink-0"
      style={{
        width: 220,
        backgroundColor: "var(--sf-black)",
        borderRight: "1px solid #222",
      }}
    >
      <div className="relative flex flex-col">
        {/* Continuous vertical line behind nodes (centered in track; pl-2 = 8px so center at 8 + 9 = 17) */}
        {steps.length > 1 && (
          <div
            className="absolute top-0 bottom-0"
            style={{
              width: LINE_WIDTH,
              left: 8 + (TRACK_WIDTH - LINE_WIDTH) / 2,
              backgroundColor: "#333",
              marginTop: NODE_SIZE / 2 + 2,
              marginBottom: NODE_SIZE / 2 + 2,
            }}
          />
        )}
        {steps.map((step, i) => {
          const isCompleted = i < currentStepIndex;
          const isCurrent = i === currentStepIndex;
          const subtasks = subtasksByStep[step.id] ?? [];
          const currentSubIdx = currentSubtaskIndexByStep[step.id] ?? 0;

          return (
            <div key={step.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => onStepClick?.(i)}
                className="flex items-center gap-2 w-full text-left pl-2 pr-3 py-1.5 hover:bg-white/5 transition-colors"
              >
                <div
                  className="relative z-10 shrink-0 flex items-center justify-center"
                  style={{ width: TRACK_WIDTH, minHeight: NODE_SIZE + 4 }}
                >
                  <div
                    className="rounded-full border-2 shrink-0"
                    style={{
                      width: NODE_SIZE,
                      height: NODE_SIZE,
                      backgroundColor: isCompleted
                        ? "var(--sf-lime)"
                        : isCurrent
                        ? "var(--sf-purple)"
                        : "transparent",
                      borderColor: isCurrent
                        ? "var(--sf-purple)"
                        : isCompleted
                        ? "var(--sf-lime)"
                        : "#444",
                    }}
                  />
                </div>
                <span
                  className="text-xs truncate flex-1 min-w-0"
                  style={{
                    color: isCurrent
                      ? "var(--sf-white)"
                      : isCompleted
                      ? "var(--sf-lime)"
                      : "#666",
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {step.title}
                </span>
              </button>
              {isCurrent && subtasks.length > 0 && (
                <div className="pl-6 pr-2 pb-1 flex flex-col gap-0.5">
                  {subtasks.map((sub: Subtask, idx: number) => {
                    const isCurrentSub = idx === currentSubIdx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => onSubtaskClick?.(step.id, idx)}
                        className="text-xs text-left truncate py-0.5 px-2 rounded transition-colors"
                        style={{
                          color: isCurrentSub ? "var(--sf-purple)" : "#888",
                          backgroundColor: isCurrentSub ? "rgba(139, 92, 246, 0.15)" : "transparent",
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
        })}
      </div>
    </div>
  );
}
