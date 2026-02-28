"use client";

import { Toggle } from "@/components/ui/Toggle";
import type { DetectMode } from "@/hooks/useLiveDetect";
import type { ARStreamConnectionStatus } from "@/hooks/useARStream";

interface DetectionStats {
  handCount: number;
  sam3Count: number;
  hasReceivedResult: boolean;
}

interface DetectorSidebarProps {
  modes: Set<DetectMode>;
  onToggleMode: (mode: DetectMode) => void;
  textPrompt: string;
  onTextPromptChange: (v: string) => void;
  sam3IntervalMs?: number;
  onSam3IntervalChange?: (ms: number) => void;
  isRunning: boolean;
  mpLoading?: boolean;
  stats: DetectionStats;
  arStreamEnabled?: boolean;
  onARStreamToggle?: (v: boolean) => void;
  arConnectionStatus?: ARStreamConnectionStatus;
  arLastAckTs?: number | null;
  /** Transparent floating variant for immersive mode */
  floating?: boolean;
}

const MODE_LABELS: Record<DetectMode, string> = {
  hands: "Hand Tracking",
  sam3: "SAM 3 Segmentation",
};

export function DetectorSidebar({
  modes,
  onToggleMode,
  textPrompt,
  onTextPromptChange,
  sam3IntervalMs = 500,
  onSam3IntervalChange,
  isRunning,
  mpLoading = false,
  stats,
  arStreamEnabled = false,
  onARStreamToggle,
  arConnectionStatus = "closed",
  arLastAckTs = null,
  floating = false,
}: DetectorSidebarProps) {
  return (
    <aside
      className={
        floating
          ? "flex flex-col gap-5 p-5 overflow-y-auto"
          : "w-64 flex flex-col gap-5 p-5 shrink-0 overflow-y-auto"
      }
      style={
        floating
          ? {}
          : { borderRight: "1px solid #222", backgroundColor: "var(--sf-black)" }
      }
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
          {(["hands", "sam3"] as DetectMode[]).map((mode) => (
            <div key={mode}>
              <Toggle
                checked={modes.has(mode)}
                onChange={() => onToggleMode(mode)}
                label={MODE_LABELS[mode]}
              />
              {modes.has(mode) && mode === "hands" && (
                <p className="text-xs ml-1 mt-0.5" style={{ color: "var(--sf-lime)", opacity: 0.7 }}>
                  {mpLoading ? "Loading model…" : "Real-time · on device"}
                </p>
              )}
              {modes.has(mode) && mode === "sam3" && (
                <p className="text-xs ml-1 mt-0.5" style={{ color: "#A855F7", opacity: 0.7 }}>
                  Cloud GPU · concept masks
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SAM3 text prompt */}
      {modes.has("sam3") && (
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: "#777" }}>Text Prompt</label>
          <input
            type="text"
            value={textPrompt}
            onChange={(e) => onTextPromptChange(e.target.value)}
            placeholder="e.g. yellow hard hat, coffee mug..."
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "#111",
              border: "1px solid #333",
              color: "var(--sf-white)",
            }}
          />
          <p className="text-xs mt-1" style={{ color: "#444" }}>
            SAM 3 finds and segments all matching objects
          </p>
        </div>
      )}

      {/* SAM3 interval slider */}
      {modes.has("sam3") && onSam3IntervalChange && (
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: "#777" }}>
            SAM 3 Rate — {sam3IntervalMs}ms
          </label>
          <input
            type="range"
            min={200}
            max={3000}
            step={100}
            value={sam3IntervalMs}
            onChange={(e) => onSam3IntervalChange(Number(e.target.value))}
            className="w-full accent-purple-500"
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: "#444" }}>
            <span>Fast (200ms)</span>
            <span>Slow (3s)</span>
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
            {modes.has("sam3") && (
              <div className="flex items-center justify-between">
                <span style={{ color: "#888" }}>SAM 3</span>
                {!stats.hasReceivedResult ? (
                  <span className="text-xs" style={{ color: "#444" }}>loading</span>
                ) : (
                  <span className="font-bold" style={{ color: stats.sam3Count > 0 ? "#A855F7" : "#444" }}>
                    {stats.sam3Count > 0 ? `${stats.sam3Count} mask${stats.sam3Count > 1 ? "s" : ""}` : "—"}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
