"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import type { Workflow } from "@/types";
import { getWorkflow, getStepInstruction, elaborateStep, checkStepSuggest } from "@/lib/api-client";
import { showErrorToast } from "@/store/toast-store";
import { videoUrl, frameUrl } from "@/lib/constants";
import { renderHandLandmarks } from "@/lib/annotation-renderer";
import { StepVideoOverlay } from "@/components/player/StepVideoOverlay";
import { StepProgressBar } from "@/components/player/StepProgressBar";
import { StepTimelineVertical } from "@/components/player/StepTimelineVertical";
import { StepTransition } from "@/components/player/StepTransition";
import { CopilotPanel } from "@/components/chat/CopilotPanel";
import { useCopilotChat } from "@/hooks/useCopilotChat";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { useMediaPipeDetect } from "@/hooks/useMediaPipeDetect";
import { useDoubleTapDetection } from "@/hooks/useDoubleTapDetection";
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
  const [isTrainingMode, setIsTrainingMode] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const suggestPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraOverlayRafRef = useRef<number>(0);
  const [cameraHands, setCameraHands] = useState<import("@/hooks/useLiveDetect").HandData | null>(null);
  const cameraHandsRef = useRef<import("@/hooks/useLiveDetect").HandData | null>(null);
  const [lastDetectionResult, setLastDetectionResult] = useState<{
    hands: { hands: Array<{ landmarks: Array<{ x: number; y: number; z?: number }> }> } | null;
    sam3_segments: Array<{ mask_base64?: string; bbox: number[]; score: number }>;
  } | null>(null);

  const {
    currentStepIndex,
    isPausedAtStepEnd,
    setCurrentStepIndex,
    setIsPausedAtStepEnd,
    setStepProgress,
    setCurrentInstruction,
    setIsPlaying,
    reset,
    setSubtasksForStep,
    setCurrentSubtaskIndex,
    subtasksByStep,
    currentSubtaskIndexByStep,
    addChatMessage,
    setSuggestComplete,
    suggestCompleteForStep,
    suggestCompleteMessage,
  } = usePlayerStore();

  const currentStep = workflow?.steps[currentStepIndex] ?? null;
  const { sendMessage } = useCopilotChat(workflowId, currentStep?.id ?? "");

  const isElaborateKeyword = useCallback((text: string) => {
    const t = text.trim().toLowerCase();
    return /elaborate|break it down|more detail|break down this step/.test(t);
  }, []);

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (isElaborateKeyword(message) && workflow && currentStep) {
        addChatMessage({ role: "user", content: message, timestamp: Date.now() });
        setIsElaborating(true);
        try {
          const { subtasks } = await elaborateStep(workflowId, currentStep.id, message);
          if (subtasks.length > 0) {
            setSubtasksForStep(currentStep.id, subtasks);
            addChatMessage({
              role: "assistant",
              content: `I've broken this step into ${subtasks.length} subtasks. Check the timeline above.`,
              timestamp: Date.now(),
            });
          } else {
            addChatMessage({
              role: "assistant",
              content: "I couldn't break that down into subtasks. Try asking in a different way.",
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          showErrorToast(err);
          addChatMessage({
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
            timestamp: Date.now(),
          });
        } finally {
          setIsElaborating(false);
        }
        return;
      }
      sendMessage(message);
    },
    [workflow, workflowId, currentStep, isElaborateKeyword, addChatMessage, setSubtasksForStep, sendMessage]
  );

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
      setSuggestComplete(null, null);
      setStepProgress(0);
      setCurrentStepIndex(index);
      setIsPausedAtStepEnd(false);
      handleStepChange(index);
    },
    [setSuggestComplete, setStepProgress, setCurrentStepIndex, setIsPausedAtStepEnd, handleStepChange]
  );

  const handleSubtaskClick = useCallback(
    (stepId: string, index: number) => {
      setCurrentSubtaskIndex(stepId, index);
    },
    [setCurrentSubtaskIndex]
  );

  const [isElaborating, setIsElaborating] = useState(false);
  const handleElaborate = useCallback(async () => {
    if (!workflow || !currentStep) return;
    setIsElaborating(true);
    try {
      const { subtasks } = await elaborateStep(workflowId, currentStep.id);
      if (subtasks.length > 0) {
        setSubtasksForStep(currentStep.id, subtasks);
      }
    } catch (err) {
      showErrorToast(err);
    } finally {
      setIsElaborating(false);
    }
  }, [workflow, workflowId, currentStep, setSubtasksForStep]);

  const handleVideoEnded = useCallback(() => {
    if (!workflow) return;
    setIsPlaying(false);
    setStepProgress(1);
    setIsPausedAtStepEnd(true);
  }, [workflow, setIsPlaying, setStepProgress, setIsPausedAtStepEnd]);

  const handleAdvanceStep = useCallback(() => {
    if (!workflow || !currentStep) return;
    setSuggestComplete(null, null);
    const subtasks = subtasksByStep[currentStep.id] ?? [];
    const currentSubIdx = currentSubtaskIndexByStep[currentStep.id] ?? 0;
    if (subtasks.length > 0 && currentSubIdx < subtasks.length - 1) {
      setCurrentSubtaskIndex(currentStep.id, currentSubIdx + 1);
      setIsPausedAtStepEnd(false);
      return;
    }
    if (currentStepIndex >= workflow.steps.length - 1) return;
    const nextIdx = currentStepIndex + 1;
    setStepProgress(0);
    setIsPausedAtStepEnd(false);
    setCurrentStepIndex(nextIdx);
    handleStepChange(nextIdx);
  }, [workflow, currentStep, currentStepIndex, subtasksByStep, currentSubtaskIndexByStep, setSuggestComplete, setCurrentSubtaskIndex, setStepProgress, setIsPausedAtStepEnd, setCurrentStepIndex, handleStepChange]);

  const handleVoiceNextStep = useCallback(() => {
    const state = usePlayerStore.getState();
    const idx = state.currentStepIndex;
    if (!workflow || idx >= workflow.steps.length) return;
    setSuggestComplete(null, null);
    const step = workflow.steps[idx];
    const subtasks = step ? (state.subtasksByStep[step.id] ?? []) : [];
    const currentSubIdx = step ? (state.currentSubtaskIndexByStep[step.id] ?? 0) : 0;
    if (subtasks.length > 0 && currentSubIdx < subtasks.length - 1) {
      setCurrentSubtaskIndex(step.id, currentSubIdx + 1);
      setIsPausedAtStepEnd(false);
      return;
    }
    if (idx >= workflow.steps.length - 1) return;
    setStepProgress(0);
    setCurrentStepIndex(idx + 1);
    setIsPausedAtStepEnd(false);
    handleStepChange(idx + 1);
  }, [workflow, handleStepChange, setSuggestComplete, setStepProgress, setCurrentStepIndex, setCurrentSubtaskIndex, setIsPausedAtStepEnd]);

  const handleVoicePrevStep = useCallback(() => {
    const state = usePlayerStore.getState();
    const idx = state.currentStepIndex;
    if (!workflow || idx < 0) return;
    const step = workflow.steps[idx];
    const currentSubIdx = step ? (state.currentSubtaskIndexByStep[step.id] ?? 0) : 0;
    if (currentSubIdx > 0 && step) {
      setCurrentSubtaskIndex(step.id, currentSubIdx - 1);
      setIsPausedAtStepEnd(false);
      return;
    }
    if (idx <= 0) return;
    setStepProgress(0);
    setCurrentStepIndex(idx - 1);
    setIsPausedAtStepEnd(false);
    handleStepChange(idx - 1);
  }, [workflow, handleStepChange, setStepProgress, setCurrentStepIndex, setCurrentSubtaskIndex, setIsPausedAtStepEnd]);

  const voice = useVoiceCommands({
    onNextStep: handleVoiceNextStep,
    onPreviousStep: handleVoicePrevStep,
    onFinish: () => {},
    onElaborate: handleElaborate,
    enabled: !!workflow,
    requireUserGesture: true,
  });

  // Camera for training mode
  useEffect(() => {
    if (!isTrainingMode) {
      cameraStream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (!cancelled) setCameraStream(stream);
        else stream.getTracks().forEach((t) => t.stop());
      })
      .catch((err) => {
        if (!cancelled) showErrorToast(err);
      });
    return () => {
      cancelled = true;
    };
  }, [isTrainingMode]);

  useEffect(() => {
    if (cameraRef.current && cameraStream) {
      cameraRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  // Poll check-step-suggest when in training mode and step has sam3_prompt
  const TRAINING_POLL_MS = 2000;
  useEffect(() => {
    if (!isTrainingMode || !workflow || !currentStep?.sam3_prompt || !cameraRef.current || !cameraStream) {
      if (suggestPollRef.current) {
        clearInterval(suggestPollRef.current);
        suggestPollRef.current = null;
      }
      return;
    }
    const captureAndCheck = async () => {
      const video = cameraRef.current;
      if (!video || video.readyState < 2) return;
      if (!captureCanvasRef.current) captureCanvasRef.current = document.createElement("canvas");
      const canvas = captureCanvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      const base64 = dataUrl.split(",")[1];
      if (!base64) return;
      try {
        const res = await checkStepSuggest(workflowId, currentStep.id, base64);
        setLastDetectionResult({
          hands: res.hands ?? null,
          sam3_segments: res.sam3_segments ?? [],
        });
        if (res.suggest_complete) {
          setSuggestComplete(currentStep.id, res.message);
        }
      } catch {
        // Ignore poll errors (e.g. SAM3 unavailable)
      }
    };
    suggestPollRef.current = setInterval(captureAndCheck, TRAINING_POLL_MS);
    return () => {
      if (suggestPollRef.current) {
        clearInterval(suggestPollRef.current);
        suggestPollRef.current = null;
      }
    };
  }, [isTrainingMode, workflow, workflowId, currentStep, cameraStream, setSuggestComplete]);

  const handleToggleTraining = useCallback(() => {
    setIsTrainingMode((prev) => !prev);
    if (isTrainingMode) {
      setSuggestComplete(null, null);
      setLastDetectionResult(null);
    }
  }, [isTrainingMode, setSuggestComplete]);

  useMediaPipeDetect({
    videoRef: cameraRef,
    handsEnabled: true,
    objectsEnabled: false,
    enabled: isTrainingMode && !!cameraStream,
    onResult: (r) => {
      cameraHandsRef.current = r.hands;
    },
  });

  useEffect(() => {
    if (!isTrainingMode) {
      setCameraHands(null);
      return;
    }
    const t = setInterval(() => {
      setCameraHands(cameraHandsRef.current);
    }, 200);
    return () => clearInterval(t);
  }, [isTrainingMode]);

  useDoubleTapDetection(isTrainingMode ? cameraHands : null, {
    onSkipForward: handleVoiceNextStep,
    onSkipBackward: handleVoicePrevStep,
  });

  const SAM3_STROKE_COLORS = ["#00FF80", "#00C8FF", "#FF64FF", "#FFC800", "#FF5050", "#648CFF"];

  useEffect(() => {
    if (!isTrainingMode || !cameraRef.current) return;
    const video = cameraRef.current;
    const canvas = cameraOverlayCanvasRef.current;
    if (!canvas) return;

    const render = (t: number) => {
      const rect = video.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (canvas.width !== rect.width || canvas.height !== rect.height)) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cameraOverlayRafRef.current = requestAnimationFrame(render);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const result = lastDetectionResult;
      if (result) {
        if (result.hands?.hands?.length) {
          renderHandLandmarks(ctx, result.hands.hands, canvas.width, canvas.height, t);
        }
        if (result.sam3_segments?.length) {
          const labelPrefix = currentStep?.sam3_prompt ?? "Object";
          result.sam3_segments.forEach((seg, i) => {
            const [bx1, by1, bx2, by2] = seg.bbox ?? [0, 0, 0, 0];
            const sx = bx1 * canvas.width;
            const sy = by1 * canvas.height;
            const sw = (bx2 - bx1) * canvas.width;
            const sh = (by2 - by1) * canvas.height;
            const strokeColor = SAM3_STROKE_COLORS[i % SAM3_STROKE_COLORS.length];
            ctx.save();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 3;
            ctx.globalAlpha = 1;
            ctx.strokeRect(sx, sy, sw, sh);
            const label = `${labelPrefix} ${Math.round((seg.score ?? 0) * 100)}%`;
            ctx.font = "bold 14px system-ui";
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = strokeColor;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(sx, sy - 24, tw + 12, 24);
            ctx.fillStyle = "#fff";
            ctx.globalAlpha = 1;
            ctx.fillText(label, sx + 6, sy - 7);
            ctx.restore();
          });
        }
      }
      cameraOverlayRafRef.current = requestAnimationFrame(render);
    };
    cameraOverlayRafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(cameraOverlayRafRef.current);
  }, [isTrainingMode, lastDetectionResult, currentStep?.sam3_prompt]);

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
      <StepProgressBar
        steps={workflow.steps}
        onStepClick={handleStepClick}
        onSubtaskClick={handleSubtaskClick}
      />

      <div className="flex flex-1 overflow-hidden">
        <StepTimelineVertical
          steps={workflow.steps}
          onStepClick={handleStepClick}
          onSubtaskClick={handleSubtaskClick}
        />
        {/* Video area */}
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden min-w-0">
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
            {currentStep && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleElaborate}
                disabled={isElaborating}
              >
                {isElaborating ? "…" : "Elaborate"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleToggleTraining}
            >
              {isTrainingMode ? "Stop training" : "Start training"}
            </Button>
            <button
              type="button"
              onClick={() => voice.startListening?.()}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors border border-solid"
              style={{
                borderColor: voice.status === "unavailable" ? "rgba(239,68,68,0.5)" : voice.isListening ? "var(--sf-lime)" : "#444",
                color: voice.status === "unavailable" ? "rgba(239,68,68,0.9)" : voice.isListening ? "var(--sf-lime)" : "#888",
                backgroundColor: voice.isListening ? "rgba(190,242,100,0.1)" : "transparent",
              }}
              title={voice.unavailableReason ?? "Click to enable voice commands — say “next step”, “go back”, or “elaborate”"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
              {voice.status === "unavailable"
                ? "Voice unavailable"
                : voice.isListening
                  ? "Listening"
                  : "Enable voice"}
            </button>
            {badge}
          </div>

          <div className="flex-1 min-h-0 flex gap-3">
            {/* Reference: step video (or left half when training) */}
            <div className={isTrainingMode ? "w-1/2 min-w-0 flex flex-col gap-1" : "flex-1 min-h-0 flex flex-col gap-1"}>
              {stepVideoPath ? (
                <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black rounded-xl overflow-hidden">
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
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleVideoEnded}
                  />
                  {currentStep && (
                    <StepVideoOverlay videoRef={videoRef} step={currentStep} />
                  )}
                  {!isTrainingMode && isPausedAtStepEnd && currentStep && (
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
                  className="w-full h-full flex items-center justify-center rounded-xl text-sm flex-1 min-h-0"
                  style={{ backgroundColor: "#111", color: "#555" }}
                >
                  No video available for this step
                </div>
              )}
              {/* Keyframe strip for current step */}
              {currentStep?.frames && currentStep.frames.length > 0 && (
                <div className="flex gap-1 overflow-x-auto py-1 shrink-0" style={{ maxHeight: 56 }}>
                  {currentStep.frames
                    .filter((f) => f.frame_path)
                    .slice(0, 12)
                    .map((f) => (
                      <a
                        key={f.id}
                        href={frameUrl(f.frame_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded overflow-hidden border border-[#333] hover:border-[var(--sf-lime)]"
                        style={{ width: 64, height: 36 }}
                      >
                        <img
                          src={frameUrl(f.frame_path)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </a>
                    ))}
                </div>
              )}
            </div>
            {/* Camera feed (training mode only) */}
            {isTrainingMode && (
              <div className="w-1/2 min-w-0 flex flex-col rounded-xl overflow-hidden bg-black">
                <div className="relative flex-1 min-h-0">
                  <video
                    ref={cameraRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                  <canvas
                    ref={cameraOverlayCanvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ objectFit: "contain" }}
                  />
                </div>
                <span className="text-xs px-2 py-1 text-center" style={{ color: "#555" }}>
                  Your camera — detection runs every 2s
                </span>
              </div>
            )}
          </div>
          {/* Suggest-complete banner (training mode) */}
          {isTrainingMode && currentStep && suggestCompleteForStep === currentStep.id && (
            <div
              className="shrink-0 flex items-center justify-between rounded-xl px-5 py-3"
              style={{ backgroundColor: "#111", border: "1px solid var(--sf-lime)" }}
            >
              <div>
                <p className="text-xs" style={{ color: "var(--sf-lime)" }}>Step looks complete</p>
                <p className="text-sm" style={{ color: "var(--sf-white)" }}>
                  {suggestCompleteMessage ?? "Say 'next' or tap Continue."}
                </p>
              </div>
              <Button size="sm" onClick={handleAdvanceStep}>
                Continue
              </Button>
            </div>
          )}
          {/* Skip this step (training mode): for steps with no detection or when stuck */}
          {isTrainingMode && currentStep && workflow && currentStepIndex < workflow.steps.length - 1 && (
            <div
              className="shrink-0 flex items-center justify-between gap-3 rounded-xl px-5 py-2.5"
              style={{ backgroundColor: "#0d0d0d", border: "1px solid #333" }}
            >
              <p className="text-xs" style={{ color: "#888" }}>
                Nothing to detect or stuck? Skip and continue — this step will be treated as done with no extra context.
              </p>
              <Button variant="secondary" size="sm" onClick={handleAdvanceStep}>
                Skip this step
              </Button>
            </div>
          )}
        </div>

        <div className="w-80 shrink-0">
          <CopilotPanel currentStep={currentStep} onSendMessage={handleSendMessage} />
        </div>
      </div>
    </div>
  );
}
