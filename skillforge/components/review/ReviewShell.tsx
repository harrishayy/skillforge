"use client";
import Link from "next/link";
import { useReviewStore } from "@/store/review-store";
import { Button } from "@/components/ui/Button";
import { StepStrip } from "./StepStrip";
import { StepReviewCard } from "./StepReviewCard";
import { ReviewActionBar } from "./ReviewActionBar";

interface ReviewShellProps {
  workflowId: string;
}

export function ReviewShell({ workflowId }: ReviewShellProps) {
  const { workflow, activeStepIndex } = useReviewStore();

  if (!workflow) return null;

  const activeStep = workflow.steps[activeStepIndex];

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "var(--sf-black)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-4 px-6 py-3 shrink-0"
        style={{ borderBottom: "1px solid #222" }}
      >
        <Link
          href="/workflows"
          className="text-sm font-medium transition-colors"
          style={{ color: "#777" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sf-purple)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#777")}
        >
          ← Workflows
        </Link>
        <h1 className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>
          Review: {workflow.title}
        </h1>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "rgba(122,120,255,0.15)", color: "var(--sf-purple)" }}
        >
          {workflow.steps.length} steps
        </span>
        <span className="ml-auto text-xs" style={{ color: "#555" }}>
          Review each step, then finalize
        </span>
        <Link href={`/editor/${workflowId}`}>
          <Button size="sm" variant="secondary">
            Skip to Editor →
          </Button>
        </Link>
      </div>

      {/* Step strip */}
      <StepStrip />

      {/* Main content */}
      {activeStep ? (
        <StepReviewCard step={activeStep} workflowId={workflowId} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "#444" }}>No steps found in this workflow.</p>
        </div>
      )}

      {/* Action bar */}
      <ReviewActionBar workflowId={workflowId} />
    </div>
  );
}
