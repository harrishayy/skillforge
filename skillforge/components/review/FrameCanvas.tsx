"use client";
import { useRef, useCallback } from "react";
import { useReviewStore } from "@/store/review-store";
import { frameUrl } from "@/lib/constants";
import type { Step } from "@/types";

interface FrameCanvasProps {
  step: Step;
}

export function FrameCanvas({ step }: FrameCanvasProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const { stepStates, addSegment } = useReviewStore();
  const ps = stepStates[step.id];

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const ts = Math.round((step.start_ms + step.end_ms) / 2);
      addSegment(step.id, x, y, ts);
    },
    [step, addSegment]
  );

  return (
    <div className="relative flex-1 flex items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: "#111" }}>
      {step.key_frame_path ? (
        <div className="relative cursor-crosshair" onClick={handleClick}>
          <img
            ref={imgRef}
            src={frameUrl(step.key_frame_path)}
            alt={`Step ${step.step_number} key frame`}
            className="max-w-full max-h-[60vh] rounded-lg object-contain"
            draggable={false}
          />

          {/* Annotation overlays */}
          {step.annotations.map((ann) => (
            <div key={ann.id}>
              {ann.type === "bounding_box" && ann.x != null && ann.y != null && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${ann.x}%`,
                    top: `${ann.y}%`,
                    width: `${ann.width ?? 10}%`,
                    height: `${ann.height ?? 10}%`,
                    border: `2px ${ann.style === "dashed" ? "dashed" : "solid"} ${ann.color}`,
                    borderRadius: 4,
                  }}
                >
                  {ann.label && (
                    <span
                      className="absolute -top-5 left-0 text-[9px] font-bold px-1 rounded"
                      style={{ backgroundColor: ann.color, color: "#fff" }}
                    >
                      {ann.label}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Click target overlays */}
          {step.click_targets.map((ct) => (
            <div
              key={ct.id}
              className="absolute pointer-events-none"
              style={{
                left: `${ct.bbox_x}%`,
                top: `${ct.bbox_y}%`,
                width: `${ct.bbox_width}%`,
                height: `${ct.bbox_height}%`,
                border: `2px solid ${ct.is_primary ? "var(--sf-lime)" : "var(--sf-purple)"}`,
                borderRadius: 4,
                backgroundColor: ct.is_primary
                  ? "rgba(199,255,105,0.1)"
                  : "rgba(122,120,255,0.08)",
              }}
            />
          ))}

          {/* SAM3 segment mask overlays */}
          {ps?.segments.map((seg, i) => (
            <div
              key={i}
              className="absolute pointer-events-none"
              style={{
                left: `${seg.bbox[0] * 100}%`,
                top: `${seg.bbox[1] * 100}%`,
                width: `${(seg.bbox[2] - seg.bbox[0]) * 100}%`,
                height: `${(seg.bbox[3] - seg.bbox[1]) * 100}%`,
                border: "2px solid var(--sf-yellow)",
                borderRadius: 4,
                backgroundColor: "rgba(255,196,18,0.15)",
              }}
            />
          ))}

          {ps?.isSegmenting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
              <div className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: "var(--sf-yellow)", color: "var(--sf-black)" }}>
                Segmenting...
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm" style={{ color: "#444" }}>
          No key frame available for this step
        </div>
      )}

      <div
        className="absolute bottom-3 left-3 text-[10px] font-medium px-2 py-1 rounded-md"
        style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "#888" }}
      >
        Click on frame to add SAM3 segmentation
      </div>
    </div>
  );
}
