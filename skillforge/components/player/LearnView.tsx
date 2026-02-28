"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import type { Workflow } from "@/types";
import { getWorkflow, getStepInstruction } from "@/lib/api-client";
import { showErrorToast } from "@/store/toast-store";
import { videoUrl } from "@/lib/constants";
import { StepVideoOverlay } from "@/components/player/StepVideoOverlay";
import { StepProgressBar } from "@/components/player/StepProgressBar";
import { StepTransition } from "@/components/player/StepTransition";
import { CopilotPanel } from "@/components/chat/CopilotPanel";
import { useCopilotChat } from "@/hooks/useCopilotChat";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { usePlayerStore } from "@/store/player-store";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { TaskTypeBadge } from "@/components/shared/TaskTypeBadge";

interface LearnViewProps {
  workflowId: string;
  backHref: string;
  backLabel: string;
  /** Accent color for the back link hover. Defaults to sf-lime. */
  accentColor?: string;
  /** Optional badge shown next to the title. */
  badge?: React.ReactNode;
}

export function LearnView({
  workflowId,
  backHref,
  backLabel,
  accentColor = "var(--sf-lime)",
  badge,
}: LearnViewProps) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const {
    currentStepIndex,
    isPausedAtStepEnd,
    setCurrentStepIndex,
    setIsPausedAtStepEnd,
    setStepProgress,
    setCurrentInstruction,
    setIsPlaying,
    reset,
  } = usePlayerStore();

  const currentStep = workflow?.steps[currentStepIndex] ?? null;
  const { sendMessage } = useCopilotChat(workflowId, currentStep?.id ?? "");

  useEffect(() => {
    reset();
    getWorkflow(workflowId)
      .then((wf) => {
        setWorkflow(wf);
        if (wf.steps.length > 0) {
          getStepInstruction(workflowId, wf.steps[0].id)
            .then((instruction) => setCurrentInstruction(instruction))
            .catch((err) => showErrorToast(err));
        }
      })
      .catch((e) => { showErrorToast(e); setError(e.message); })
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
      } catch (err) {
        showErrorToast(err);
      }
    },
    [workflow, workflowId, setCurrentInstruction, setIsPausedAtStepEnd]
  );

  // RAF-based progress tracker — fires every frame (~16ms) for smooth bar fill
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  useEffect(() => {
    if (!isPlaying) return;
    let raf: number;
    const tick = () => {
      const video = videoRef.current;
      if (video && video.duration && !isNaN(video.duration) && video.duration > 0) {
        setStepProgress(video.currentTime / video.duration);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, currentStepIndex, setStepProgress]);

  const handleStepClick = useCallback(
    (index: number) => {
      setStepProgress(0);
      setCurrentStepIndex(index);
      setIsPausedAtStepEnd(false);
      handleStepChange(index);
    },
    [setStepProgress, setCurrentStepIndex, setIsPausedAtStepEnd, handleStepChange]
  );

  const handleVideoEnded = useCallback(() => {
    if (!workflow) return;
    setIsPlaying(false);
    setStepProgress(1);
    setIsPausedAtStepEnd(true);
  }, [workflow, setIsPlaying, setStepProgress, setIsPausedAtStepEnd]);

  const handleAdvanceStep = useCallback(() => {
    if (!workflow || currentStepIndex >= workflow.steps.length - 1) return;
    const nextIdx = currentStepIndex + 1;
    setStepProgress(0);
    setIsPausedAtStepEnd(false);
    setCurrentStepIndex(nextIdx);
    handleStepChange(nextIdx);
  }, [workflow, currentStepIndex, setStepProgress, setIsPausedAtStepEnd, setCurrentStepIndex, handleStepChange]);

  const handleVoiceNextStep = useCallback(() => {
    const idx = usePlayerStore.getState().currentStepIndex;
    if (!workflow || idx >= workflow.steps.length - 1) return;
    setStepProgress(0);
    setCurrentStepIndex(idx + 1);
    setIsPausedAtStepEnd(false);
    handleStepChange(idx + 1);
  }, [workflow, handleStepChange, setStepProgress, setCurrentStepIndex, setIsPausedAtStepEnd]);

  const handleVoicePrevStep = useCallback(() => {
    const idx = usePlayerStore.getState().currentStepIndex;
    if (!workflow || idx <= 0) return;
    setStepProgress(0);
    setCurrentStepIndex(idx - 1);
    setIsPausedAtStepEnd(false);
    handleStepChange(idx - 1);
  }, [workflow, handleStepChange, setStepProgress, setCurrentStepIndex, setIsPausedAtStepEnd]);

  useVoiceCommands({
    onNextStep: handleVoiceNextStep,
    onPreviousStep: handleVoicePrevStep,
    onFinish: () => {},
    enabled: !!workflow,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <span style={{ color: accentColor }}><Spinner className="w-8 h-8" /></span>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <div className="text-center">
          <p className="mb-4" style={{ color: "var(--sf-orange)" }}>{error ?? "Workflow not found"}</p>
          <Link href={backHref}>
            <Button variant="secondary">{backLabel}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const stepVideoPath = currentStep?.video_path;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: "var(--sf-black)" }}>
      <StepProgressBar steps={workflow.steps} onStepClick={handleStepClick} />

      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={backHref}
              className="text-sm font-medium transition-colors"
              style={{ color: "#777" }}
              onMouseEnter={e => (e.currentTarget.style.color = accentColor)}
              onMouseLeave={e => (e.currentTarget.style.color = "#777")}
            >
              {backLabel}
            </Link>
            <h1 className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>{workflow.title}</h1>
            <TaskTypeBadge />
            {badge}
          </div>

          <div className="flex-1 min-h-0">
            {stepVideoPath ? (
              <div className="relative w-full h-full flex items-center justify-center bg-black rounded-xl overflow-hidden">
                <video
                  ref={videoRef}
                  key={currentStep!.id}
                  src={videoUrl(stepVideoPath)}
                  className="w-full h-full object-contain"
                  controls
                  playsInline
                  autoPlay
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={handleVideoEnded}
                />
                {currentStep && (
                  <StepVideoOverlay videoRef={videoRef} step={currentStep} />
                )}
                {isPausedAtStepEnd && currentStep && (
                  <StepTransition
                    key={`transition-${currentStepIndex}`}
                    completedStep={currentStep}
                    nextStep={workflow.steps[currentStepIndex + 1] ?? null}
                    currentIndex={currentStepIndex}
                    totalSteps={workflow.steps.length}
                    onContinue={handleAdvanceStep}
                  />
                )}
              </div>
            ) : (
              <div
                className="w-full h-full flex items-center justify-center rounded-xl text-sm"
                style={{ backgroundColor: "#111", color: "#555" }}
              >
                No video available for this step
              </div>
            )}
          </div>
        </div>

        <div className="w-80 shrink-0">
          <CopilotPanel currentStep={currentStep} onSendMessage={sendMessage} />
        </div>
      </div>
    </div>
  );
}
