"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { PipelineEvent, PipelineLogEvent } from "@/types";
import { useWorkflowSocket } from "@/hooks/useWorkflowSocket";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface PipelineStatusProps {
  workflowId: string | null;
  onComplete?: () => void;
  /** Logs to seed the stream before the WebSocket connects (e.g. upload-phase logs). */
  initialLogs?: PipelineLogEvent[];
  /** When set, shows an inline error with retry/back actions. */
  uploadError?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  upload: "Upload",
  frame_extraction: "Extracting frames",
  nemotron_vl: "Nemotron VL analysis",
  yolo: "Detecting UI elements",
  mediapipe: "Tracking hand movements",
  claude_decompose: "Claude decomposing workflow",
  storage: "Uploading to CDN",
  complete: "Complete",
  error: "Error",
};

export function PipelineStatus({
  workflowId,
  onComplete,
  initialLogs,
  uploadError,
  onRetry,
  onBack,
}: PipelineStatusProps) {
  const router = useRouter();
  const [wsLogs, setWsLogs] = useState<PipelineLogEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const allLogs = [...(initialLogs ?? []), ...wsLogs];

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allLogs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useWorkflowSocket(workflowId, (event: PipelineEvent) => {
    if (event.type === "pipeline_log") {
      setWsLogs((prev) => [...prev, event]);
      setProgress(event.progress);
    }
    if (event.type === "step_created") {
      setWsLogs((prev) => [
        ...prev,
        {
          type: "pipeline_log",
          stage: "claude_decompose",
          message: `Step ${event.step.step_number} created: "${event.step.title}"`,
          progress: prev[prev.length - 1]?.progress ?? 70,
          timestamp: Date.now(),
        },
      ]);
    }
    if (event.type === "complete") {
      setProgress(100);
      setIsDone(true);
      setTimeout(() => {
        if (onComplete) onComplete();
        else router.push(`/editor/${workflowId}`);
      }, 1500);
    }
    if (event.type === "error") {
      setWsLogs((prev) => [
        ...prev,
        {
          type: "pipeline_log",
          stage: "error",
          message: `Error: ${event.message}`,
          progress: 0,
          timestamp: Date.now(),
        },
      ]);
    }
  });

  const isUploading = !workflowId && !uploadError;
  const uploadProgress = initialLogs?.length
    ? Math.min(10, (initialLogs.length / 4) * 10)
    : 2;
  const displayProgress = workflowId ? progress : uploadProgress;

  const title = uploadError
    ? "Upload Failed"
    : isDone
      ? "Workflow Ready!"
      : isUploading
        ? "Uploading Your Recording..."
        : "AI Processing Your Recording...";

  const subtitle = uploadError
    ? uploadError
    : isDone
      ? "Redirecting to editor..."
      : isUploading
        ? "Packaging and sending your step videos to the server."
        : "Nemotron VL and Claude are analyzing your recording.";

  return (
    <div className="w-full max-w-xl mx-auto">
      <h2
        className="font-black mb-2"
        style={{
          fontSize: "1.5rem",
          letterSpacing: "-0.03em",
          color: uploadError ? "var(--sf-orange)" : "var(--sf-black)",
        }}
      >
        {title}
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--sf-gray)" }}>
        {subtitle}
      </p>

      <ProgressBar value={displayProgress} className="mb-6" />

      <div className="space-y-1 max-h-64 overflow-y-auto rounded-xl p-3" style={{ backgroundColor: "var(--sf-light-gray)" }}>
        <AnimatePresence initial={false}>
          {allLogs.map((log, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 text-sm p-2 rounded-lg"
              style={{
                backgroundColor: log.stage === "error"
                  ? "rgba(255,109,56,0.15)"
                  : log.stage === "complete"
                  ? "rgba(199,255,105,0.3)"
                  : "transparent",
                color: log.stage === "error"
                  ? "var(--sf-orange)"
                  : log.stage === "complete"
                  ? "#2d7a00"
                  : "var(--sf-black)",
              }}
            >
              <span className="text-xs w-32 shrink-0" style={{ color: "var(--sf-gray)" }}>
                {STAGE_LABELS[log.stage] ?? log.stage}
              </span>
              <span>{log.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        {isUploading && allLogs.length === 0 && (
          <div className="flex items-center gap-2 text-sm p-2" style={{ color: "var(--sf-gray)" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "var(--sf-purple)" }} />
            Preparing upload...
          </div>
        )}
        <div ref={logsEndRef} />
      </div>

      {uploadError && (onRetry || onBack) && (
        <div className="flex gap-3 justify-center mt-6">
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-sm font-bold px-5 py-2.5 rounded-xl transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-white)" }}
            >
              Retry Upload
            </button>
          )}
          {onBack && (
            <button
              onClick={onBack}
              className="text-sm font-bold px-5 py-2.5 rounded-xl transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--sf-light-gray)", color: "var(--sf-black)" }}
            >
              Back to Setup
            </button>
          )}
        </div>
      )}
    </div>
  );
}
