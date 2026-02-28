"use client";
import type { Step } from "@/types";
import { usePlayerStore } from "@/store/player-store";
import { Spinner } from "@/components/ui/Spinner";

interface StepContextProps {
  step: Step | null;
}

export function StepContext({ step }: StepContextProps) {
  const { currentInstruction, isCopilotLoading } = usePlayerStore();

  if (!step) return null;

  return (
    <div className="p-4" style={{ borderBottom: "1px solid #222" }}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold shrink-0"
          style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
        >
          {step.step_number}
        </span>
        <h3 className="text-sm font-bold truncate" style={{ color: "var(--sf-white)" }}>{step.title}</h3>
      </div>
      <div className="text-sm leading-relaxed min-h-10" style={{ color: "#aaa" }}>
        {isCopilotLoading && !currentInstruction ? (
          <div className="flex items-center gap-2" style={{ color: "#555" }}>
            <span style={{ color: "var(--sf-lime)" }}><Spinner className="w-3.5 h-3.5" /></span>
            <span>Loading instructions...</span>
          </div>
        ) : (
          currentInstruction || step.description
        )}
      </div>
    </div>
  );
}
