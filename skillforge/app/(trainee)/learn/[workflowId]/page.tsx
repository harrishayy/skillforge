"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Workflow } from "@/types";
import { getWorkflow, getStepInstruction } from "@/lib/api-client";
import { VideoWithOverlay } from "@/components/player/VideoWithOverlay";
import { StepProgressBar } from "@/components/player/StepProgressBar";
import { CopilotPanel } from "@/components/chat/CopilotPanel";
import { useCopilotChat } from "@/hooks/useCopilotChat";
import { usePlayerStore } from "@/store/player-store";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { TaskTypeBadge } from "@/components/shared/TaskTypeBadge";

export default function LearnPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    currentStepIndex,
    isPausedAtStepEnd,
    setCurrentStepIndex,
    setIsPausedAtStepEnd,
    setCurrentInstruction,
    reset,
  } = usePlayerStore();

  const currentStep = workflow?.steps[currentStepIndex] ?? null;
  const { sendMessage } = useCopilotChat(workflowId, currentStep?.id ?? "");

  useEffect(() => {
    reset();
    getWorkflow(workflowId)
      .then(setWorkflow)
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStepChange = useCallback(
    async (stepIndex: number) => {
      if (!workflow) return;
      const step = workflow.steps[stepIndex];
      if (!step) return;
      setIsPausedAtStepEnd(false);
      setCurrentInstruction("");
      try {
        const instruction = await getStepInstruction(workflowId, step.id);
        setCurrentInstruction(instruction);
      } catch {}
    },
    [workflow, workflowId, setCurrentInstruction, setIsPausedAtStepEnd]
  );

  const handleStepClick = useCallback(
    (index: number) => {
      setCurrentStepIndex(index);
      setIsPausedAtStepEnd(false);
    },
    [setCurrentStepIndex, setIsPausedAtStepEnd]
  );

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <span style={{ color: "var(--sf-lime)" }}><Spinner className="w-8 h-8" /></span>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <div className="text-center">
          <p className="mb-4" style={{ color: "var(--sf-orange)" }}>{error ?? "Workflow not found"}</p>
          <Link href="/library">
            <Button variant="secondary">Back to Library</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "var(--sf-black)" }}>
      <StepProgressBar steps={workflow.steps} onStepClick={handleStepClick} />

      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/library"
              className="text-sm font-medium transition-colors"
              style={{ color: "#777" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--sf-lime)")}
              onMouseLeave={e => (e.currentTarget.style.color = "#777")}
            >
              ← Library
            </Link>
            <h1 className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>{workflow.title}</h1>
            <TaskTypeBadge mode={workflow.mode} />
          </div>

          <div className="flex-1 min-h-0">
            {workflow.video_path ? (
              <VideoWithOverlay
                videoPath={workflow.video_path}
                steps={workflow.steps}
                workflowId={workflowId}
                onStepChange={handleStepChange}
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center rounded-xl text-sm"
                style={{ backgroundColor: "#111", color: "#555" }}
              >
                No video available
              </div>
            )}
          </div>

          {isPausedAtStepEnd && currentStep && (
            <div
              className="shrink-0 flex items-center justify-between rounded-xl px-5 py-3"
              style={{ backgroundColor: "#111", border: "1px solid #2a2a2a" }}
            >
              <div>
                <p className="text-xs" style={{ color: "var(--sf-lime)" }}>Step complete!</p>
                <p className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>
                  Next: {workflow.steps[currentStepIndex + 1]?.title ?? "You're done!"}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setIsPausedAtStepEnd(false);
                  handleStepClick(currentStepIndex + 1);
                }}
              >
                Continue →
              </Button>
            </div>
          )}
        </div>

        <div className="w-80 shrink-0">
          <CopilotPanel currentStep={currentStep} onSendMessage={sendMessage} />
        </div>
      </div>
    </div>
  );
}
