"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWebcamRecorder } from "@/hooks/useWebcamRecorder";
import { reRecordStep, getWorkflow } from "@/lib/api-client";
import { useReviewStore } from "@/store/review-store";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

type RefilmState = "setup" | "recording" | "uploading" | "done" | "error";

export default function RefilmPage() {
  const { workflowId, stepId } = useParams<{ workflowId: string; stepId: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [refilmState, setRefilmState] = useState<RefilmState>("setup");
  const [stepInfo, setStepInfo] = useState<{ title: string; step_number: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const recorder = useWebcamRecorder();
  const { replaceStep, resetStepStatus } = useReviewStore();

  useEffect(() => {
    getWorkflow(workflowId).then((wf) => {
      const s = wf.steps.find((st) => st.id === stepId);
      if (s) setStepInfo({ title: s.title, step_number: s.step_number });
    });
  }, [workflowId, stepId]);

  useEffect(() => {
    if (recorder.stream && videoRef.current) {
      videoRef.current.srcObject = recorder.stream;
    }
  }, [recorder.stream]);

  const handleStart = useCallback(async () => {
    const stream = await recorder.start();
    if (stream) {
      setRefilmState("recording");
    } else {
      setErrorMsg(recorder.error ?? "Failed to start camera");
      setRefilmState("error");
    }
  }, [recorder]);

  const handleFinish = useCallback(async () => {
    setRefilmState("uploading");
    try {
      const blob = await recorder.stop();
      const updatedStep = await reRecordStep(workflowId, stepId, blob);
      replaceStep(updatedStep);
      resetStepStatus(stepId);
      setRefilmState("done");
      setTimeout(() => router.push(`/review/${workflowId}`), 1200);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
      setRefilmState("error");
    }
  }, [recorder, workflowId, stepId, replaceStep, resetStepStatus, router]);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6" style={{ backgroundColor: "var(--sf-black)" }}>
      {/* Header info */}
      <div className="text-center">
        <h1 className="text-lg font-black" style={{ color: "var(--sf-white)", letterSpacing: "-0.03em" }}>
          Re-film Step {stepInfo?.step_number ?? ""}
        </h1>
        {stepInfo && (
          <p className="text-sm mt-1" style={{ color: "#888" }}>
            {stepInfo.title}
          </p>
        )}
      </div>

      {/* Video preview */}
      <div className="relative rounded-2xl overflow-hidden" style={{ backgroundColor: "#111", width: 640, height: 480 }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {refilmState === "recording" && (
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: "var(--sf-orange)" }} />
            <span className="text-xs font-bold" style={{ color: "var(--sf-white)" }}>
              {formatTime(recorder.durationMs)}
            </span>
          </div>
        )}

        {refilmState === "uploading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-3">
            <Spinner className="w-8 h-8" />
            <p className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>
              Uploading & re-processing...
            </p>
          </div>
        )}

        {refilmState === "done" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-3">
            <span className="text-3xl">✓</span>
            <p className="text-sm font-bold" style={{ color: "var(--sf-lime)" }}>
              Step re-filmed! Returning to review...
            </p>
          </div>
        )}

        {refilmState === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-3">
            <p className="text-sm font-bold" style={{ color: "var(--sf-orange)" }}>{errorMsg}</p>
            <Button size="sm" variant="secondary" onClick={() => router.push(`/review/${workflowId}`)}>
              Back to Review
            </Button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {refilmState === "setup" && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/review/${workflowId}`)}
            >
              ← Cancel
            </Button>
            <Button onClick={handleStart}>Start Recording</Button>
          </>
        )}

        {refilmState === "recording" && (
          <Button onClick={handleFinish} variant="danger">
            Finish Recording
          </Button>
        )}
      </div>

      <p className="text-[10px] max-w-sm text-center" style={{ color: "#555" }}>
        Record just this one step. When you finish, the step will be re-processed
        with the new footage.
      </p>
    </div>
  );
}
