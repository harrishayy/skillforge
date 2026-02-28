interface PipelineLog {
  stage: string;
  message: string;
  progress: number;
  timestamp: number;
}

interface PipelineProgressProps {
  status: "running" | "complete" | "error";
  progress: number;
  logs: PipelineLog[];
  stageLabels?: Record<string, string>;
  accentColor?: "orange" | "blue" | "green";
}

const defaultStageLabels: Record<string, string> = {
  optical_flow: "Optical Flow",
  vlm_extraction: "VLM Step Extraction",
  object_detection: "Object Detection",
  feature_extraction: "Feature Extraction",
  complete: "Complete",
  error: "Error",
};

const accentColors = {
  orange: { bar: "bg-orange-500", text: "text-orange-400" },
  blue:   { bar: "bg-blue-500",   text: "text-blue-400" },
  green:  { bar: "bg-green-500",  text: "text-green-400" },
};

/**
 * Reusable pipeline progress bar + scrollable log stream.
 * Used by both the physical capture page and any future pipeline pages.
 */
export function PipelineProgress({
  status,
  progress,
  logs,
  stageLabels = defaultStageLabels,
  accentColor = "orange",
}: PipelineProgressProps) {
  const colors = accentColors[accentColor];

  const statusLabel =
    status === "running"
      ? "Processing..."
      : status === "complete"
      ? "Analysis Complete"
      : "Pipeline Failed";

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-zinc-300 font-medium">{statusLabel}</span>
          <span className="text-zinc-400">{progress}%</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              status === "error" ? "bg-red-500" : colors.bar
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Log stream */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2 max-h-64 overflow-y-auto">
        {logs.map((log, i) => (
          <div key={i} className="flex items-start gap-3 text-xs">
            <span className={`font-mono shrink-0 mt-0.5 ${colors.text}`}>
              {stageLabels[log.stage] ?? log.stage}
            </span>
            <span className="text-zinc-300">{log.message}</span>
          </div>
        ))}
        {status === "running" && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="animate-pulse">●</span>
            <span>Waiting for updates...</span>
          </div>
        )}
        {logs.length === 0 && status !== "running" && (
          <p className="text-zinc-600 text-xs">No log output.</p>
        )}
      </div>
    </div>
  );
}
