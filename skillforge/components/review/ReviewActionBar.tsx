"use client";
import { useRouter } from "next/navigation";
import { useReviewStore } from "@/store/review-store";
import { Button } from "@/components/ui/Button";

interface ReviewActionBarProps {
  workflowId: string;
}

export function ReviewActionBar({ workflowId }: ReviewActionBarProps) {
  const router = useRouter();
  const {
    workflow,
    activeStepIndex,
    nextStep,
    prevStep,
    approveStep,
    markRefilm,
    stepStates,
    allApproved,
  } = useReviewStore();

  if (!workflow) return null;

  const step = workflow.steps[activeStepIndex];
  if (!step) return null;

  const ps = stepStates[step.id];
  const status = ps?.status ?? "pending";
  const isFirst = activeStepIndex === 0;
  const isLast = activeStepIndex === workflow.steps.length - 1;
  const canFinalize = allApproved();

  return (
    <div
      className="flex items-center justify-between px-6 py-3 shrink-0"
      style={{ borderTop: "1px solid #222", backgroundColor: "#0d0d0d" }}
    >
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={prevStep}
          disabled={isFirst}
        >
          ← Prev
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={nextStep}
          disabled={isLast}
        >
          Next →
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {status !== "approved" ? (
          <Button
            size="sm"
            onClick={() => {
              approveStep(step.id);
              if (!isLast) nextStep();
            }}
          >
            ✓ Approve Step
          </Button>
        ) : (
          <span
            className="text-xs font-bold px-3 py-1.5 rounded-full"
            style={{ backgroundColor: "rgba(199,255,105,0.15)", color: "var(--sf-lime)" }}
          >
            ✓ Approved
          </span>
        )}

        {status !== "refilm" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => markRefilm(step.id)}
          >
            ↻ Re-film
          </Button>
        )}
      </div>

      <div>
        <Button
          size="sm"
          onClick={() => router.push(`/editor/${workflowId}`)}
          disabled={!canFinalize}
        >
          Finalize & Edit →
        </Button>
        {!canFinalize && (
          <p className="text-[9px] mt-1 text-center" style={{ color: "#555" }}>
            Approve all steps first
          </p>
        )}
      </div>
    </div>
  );
}
