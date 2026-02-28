"use client";
import { useWorkflowStore } from "@/store/workflow-store";
import { StepCard } from "./StepCard";

export function StepList() {
  const { workflow, selectedStepId, selectStep } = useWorkflowStore();

  if (!workflow) return null;

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#555" }}>
          Steps ({workflow.steps.length})
        </h3>
      </div>
      {workflow.steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          isSelected={selectedStepId === step.id}
          onSelect={() => selectStep(step.id)}
        />
      ))}
    </div>
  );
}
