"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { PipelineEvent, PipelineLogEvent } from "@/types";
import { useWorkflowSocket } from "@/hooks/useWorkflowSocket";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface PipelineStatusProps {
  workflowId: string;
}

const STAGE_LABELS: Record<string, string> = {
  frame_extraction: "Extracting frames",
  nemotron_vl: "Nemotron VL analysis",
  yolo: "Detecting UI elements",
  mediapipe: "Tracking hand movements",
  claude_decompose: "Claude decomposing workflow",
  complete: "Complete",
  error: "Error",
};

export function PipelineStatus({ workflowId }: PipelineStatusProps) {
  const router = useRouter();
  const [logs, setLogs] = useState<PipelineLogEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [isDone, setIsDone] = useState(false);

  useWorkflowSocket(workflowId, (event: PipelineEvent) => {
    if (event.type === "pipeline_log") {
      setLogs((prev) => [...prev, event]);
      setProgress(event.progress);
    }
    if (event.type === "step_created") {
      setLogs((prev) => [
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
      setTimeout(() => { router.push(`/editor/${workflowId}`); }, 1500);
    }
    if (event.type === "error") {
      setLogs((prev) => [
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

  return (
    <div className="w-full max-w-xl mx-auto">
      <h2
        className="font-black mb-2"
        style={{ fontSize: "1.5rem", letterSpacing: "-0.03em", color: "var(--sf-black)" }}
      >
        {isDone ? "Workflow Ready!" : "AI Processing Your Recording..."}
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--sf-gray)" }}>
        {isDone ? "Redirecting to editor..." : "Nemotron VL and Claude are analyzing your recording."}
      </p>

      <ProgressBar value={progress} className="mb-6" />

      <div className="space-y-1 max-h-64 overflow-y-auto rounded-xl p-3" style={{ backgroundColor: "var(--sf-light-gray)" }}>
        <AnimatePresence initial={false}>
          {logs.map((log, i) => (
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
      </div>
    </div>
  );
}
