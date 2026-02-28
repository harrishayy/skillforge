"use client";

import { Toggle } from "@/components/ui/Toggle";
import { MicLevelBar } from "@/components/camera/MicLevelBar";
import type { DetectMode, YoloDetection } from "@/hooks/useLiveDetect";
import type { ARStreamConnectionStatus } from "@/hooks/useARStream";

const YOLO_COLORS = [
  "#3B82F6", "#8B5CF6", "#10B981", "#F59E0B",
  "#EF4444", "#06B6D4", "#EC4899", "#14B8A6",
];

interface DetectionStats {
  handCount: number;
  yoloCount: number;
  customFound: boolean;
  yoloDetections: YoloDetection[];
  hasReceivedResult: boolean;
}

interface DetectorSidebarProps {
  modes: Set<DetectMode>;
  onToggleMode: (mode: DetectMode) => void;
  textPrompt: string;
  onTextPromptChange: (v: string) => void;
  intervalMs: number;
  onIntervalChange: (ms: number) => void;
  isRunning: boolean;
  mpLoading?: boolean;
  stats: DetectionStats;
  micLevel: number;
  hasMic: boolean;
  arStreamEnabled?: boolean;
  onARStreamToggle?: (v: boolean) => void;
  arConnectionStatus?: ARStreamConnectionStatus;
  arLastAckTs?: number | null;
}

const MODE_LABELS: Record<DetectMode, string> = {
  hands: "Hand Tracking",
  yolo: "YOLO Objects",
  custom: "Custom Prompt",
};

export function DetectorSidebar({
  modes,
  onToggleMode,
  textPrompt,
  onTextPromptChange,
  intervalMs,
  onIntervalChange,
  isRunning,
  mpLoading = false,
  stats,
  micLevel,
  hasMic,
  arStreamEnabled = false,
  onARStreamToggle,
  arConnectionStatus = "closed",
  arLastAckTs = null,
}: DetectorSidebarProps) {
  return (
    <aside
      className="w-64 flex flex-col gap-5 p-5 shrink-0 overflow-y-auto"
      style={{ borderRight: "1px solid #222", backgroundColor: "var(--sf-black)" }}
    >
      {/* AR stream to laptop */}
      {isRunning && onARStreamToggle && (
        <div>
          <h3 className="text-xs font-black uppercase tracking-wide mb-3" style={{ color: "#555" }}>
            AR Pipeline
          </h3>
          <Toggle
            checked={arStreamEnabled}
            onChange={onARStreamToggle}
            label="Stream to laptop (AR pipeline)"
          />
          {arStreamEnabled && (
            <p className="text-xs mt-2" style={{ color: "#666" }}>
              {arConnectionStatus === "open" && "AR: connected"}
              {arConnectionStatus === "connecting" && "AR: connecting…"}
              {arConnectionStatus === "closed" && "AR: disconnected"}
              {arConnectionStatus === "error" && "AR: error"}
              {arConnectionStatus === "open" && arLastAckTs != null && (
                <span className="block mt-0.5" style={{ color: "#444" }}>Pose received</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Detection modes */}
      <div>
        <h3 className="text-xs font-black uppercase tracking-wide mb-3" style={{ color: "#555" }}>
          Detectors
        </h3>
        <div className="space-y-2">
          {(["hands", "yolo", "custom"] as DetectMode[]).map((mode) => (
            <div key={mode}>
              <Toggle
                checked={modes.has(mode)}
                onChange={() => onToggleMode(mode)}
                label={MODE_LABELS[mode]}
              />
              {modes.has(mode) && mode !== "custom" && (
                <p className="text-xs ml-1 mt-0.5" style={{ color: "var(--sf-lime)", opacity: 0.7 }}>
                  {mpLoading ? "Loading model…" : "Real-time · on device"}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Custom prompt */}
      {modes.has("custom") && (
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: "#777" }}>Text Prompt</label>
          <input
            type="text"
            value={textPrompt}
            onChange={(e) => onTextPromptChange(e.target.value)}
            placeholder="e.g. red valve, coffee mug..."
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "#111",
              border: "1px solid #333",
              color: "var(--sf-white)",
            }}
          />
          <p className="text-xs mt-1" style={{ color: "#444" }}>Uses Grounding DINO or Claude vision</p>
        </div>
      )}

      {/* Interval slider */}
      {modes.has("custom") && (
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: "#777" }}>
            Custom Prompt Rate — {intervalMs}ms
          </label>
          <input
            type="range"
            min={200}
            max={2000}
            step={100}
            value={intervalMs}
            onChange={(e) => onIntervalChange(Number(e.target.value))}
            className="w-full accent-orange-500"
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: "#444" }}>
            <span>Fast (200ms)</span>
            <span>Slow (2s)</span>
          </div>
        </div>
      )}

      {/* Live stats */}
      {isRunning && (
        <div>
          <h3 className="text-xs font-black uppercase tracking-wide mb-3" style={{ color: "#555" }}>
            Detections
          </h3>
          {!stats.hasReceivedResult && (
            <p className="text-xs mb-2 animate-pulse" style={{ color: "#444" }}>Waiting for first frame…</p>
          )}
          <div className="space-y-2 text-sm">
            {modes.has("hands") && (
              <div className="flex items-center justify-between">
                <span style={{ color: "#888" }}>Hands</span>
                {!stats.hasReceivedResult ? (
                  <span className="text-xs" style={{ color: "#444" }}>loading</span>
                ) : (
                  <span className="font-bold" style={{ color: stats.handCount > 0 ? "var(--sf-yellow)" : "#444" }}>
                    {stats.handCount}
                  </span>
                )}
              </div>
            )}
            {modes.has("yolo") && (
              <div className="flex items-center justify-between">
                <span style={{ color: "#888" }}>Objects</span>
                {!stats.hasReceivedResult ? (
                  <span className="text-xs" style={{ color: "#444" }}>loading</span>
                ) : (
                  <span className="font-bold" style={{ color: stats.yoloCount > 0 ? "var(--sf-purple)" : "#444" }}>
                    {stats.yoloCount}
                  </span>
                )}
              </div>
            )}
            {modes.has("custom") && (
              <div className="flex items-center justify-between">
                <span style={{ color: "#888" }}>Custom</span>
                {!stats.hasReceivedResult ? (
                  <span className="text-xs" style={{ color: "#444" }}>loading</span>
                ) : (
                  <span className="font-bold" style={{ color: stats.customFound ? "var(--sf-orange)" : "#444" }}>
                    {stats.customFound ? "Found" : "—"}
                  </span>
                )}
              </div>
            )}
          </div>

          {stats.yoloDetections.length > 0 && (
            <div className="mt-3 space-y-1">
              {stats.yoloDetections.map((d, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span
                    className="px-1.5 py-0.5 rounded font-medium"
                    style={{
                      backgroundColor: `${YOLO_COLORS[i % YOLO_COLORS.length]}30`,
                      color: "var(--sf-white)",
                    }}
                  >
                    {d.class}
                  </span>
                  <span style={{ color: "#555" }}>{Math.round(d.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasMic && <MicLevelBar level={micLevel} />}
    </aside>
  );
}
