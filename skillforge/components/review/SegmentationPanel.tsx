"use client";
import { useReviewStore } from "@/store/review-store";
import type { Step } from "@/types";

interface SegmentationPanelProps {
  step: Step;
}

export function SegmentationPanel({ step }: SegmentationPanelProps) {
  const { stepStates, removeSegment, clearSegments } = useReviewStore();
  const ps = stepStates[step.id];
  const segments = ps?.segments ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#666" }}>
          SAM3 Segments ({segments.length})
        </h3>
        {segments.length > 0 && (
          <button
            onClick={() => clearSegments(step.id)}
            className="text-[10px] font-medium transition-colors"
            style={{ color: "var(--sf-orange)" }}
          >
            Clear all
          </button>
        )}
      </div>

      {segments.length > 0 ? (
        <div className="space-y-1.5">
          {segments.map((seg, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ backgroundColor: "#111", border: "1px solid #222" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: "var(--sf-yellow)" }}
                />
                <span className="text-[11px]" style={{ color: "#888" }}>
                  Segment {i + 1}
                </span>
                <span className="text-[10px]" style={{ color: "#555" }}>
                  {(seg.score * 100).toFixed(0)}% conf
                </span>
              </div>
              <button
                onClick={() => removeSegment(step.id, i)}
                className="text-[10px] font-medium transition-colors"
                style={{ color: "#555" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sf-orange)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="rounded-lg p-4 text-center"
          style={{ backgroundColor: "#111", border: "1px dashed #333" }}
        >
          <p className="text-[11px] mb-1" style={{ color: "#555" }}>
            No segments added yet
          </p>
          <p className="text-[10px]" style={{ color: "#444" }}>
            Click on the frame to add a SAM3 segmentation
          </p>
        </div>
      )}
    </div>
  );
}
