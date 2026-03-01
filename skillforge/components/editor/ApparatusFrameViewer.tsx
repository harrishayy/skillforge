"use client";
import { useState, useEffect } from "react";
import { useWorkflowStore, selectedApparatusObject } from "@/store/workflow-store";
import { frameUrl } from "@/lib/constants";

export function ApparatusFrameViewer() {
  const store = useWorkflowStore();
  const object = selectedApparatusObject(store);

  const [showSegmented, setShowSegmented] = useState(true);
  const [showAllFrames, setShowAllFrames] = useState(false);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);

  useEffect(() => {
    setActiveFrameIndex(0);
    setShowAllFrames(false);
  }, [object?.id]);

  if (!object) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm" style={{ color: "#444" }}>Select an apparatus object to view</div>
      </div>
    );
  }

  const allFrames = object.reference_frame_paths ?? [];
  const hasSegmented = !!object.segmented_reference_path;

  const bestFrameIndex = Math.floor(allFrames.length / 2);
  const activeIdx = activeFrameIndex < allFrames.length ? activeFrameIndex : 0;
  const isOnSegmentedFrame = activeIdx === bestFrameIndex && hasSegmented;

  const displayPath =
    showSegmented && isOnSegmentedFrame
      ? object.segmented_reference_path!
      : allFrames[activeIdx];

  return (
    <div className="flex-1 flex flex-col gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <h2 className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>
          {object.object_name}
        </h2>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: "#1f1f1f", color: "#888", border: "1px solid #333" }}
        >
          {object.object_type}
        </span>
        {hasSegmented && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: "rgba(190,242,100,0.15)", color: "var(--sf-lime)" }}
          >
            SAM3 SEGMENTED
          </span>
        )}
        <span className="text-[10px] ml-auto" style={{ color: "#555" }}>
          {allFrames.length} reference frame{allFrames.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 flex flex-col gap-3 min-h-0">
        {/* SAM3 segmented frame (always visible if exists) */}
        {hasSegmented && (
          <div className="shrink-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--sf-lime)" }} />
              <span className="text-[10px] font-bold" style={{ color: "var(--sf-lime)" }}>
                SAM3 REFERENCE
              </span>
            </div>
            <div className="flex gap-1.5 pb-1">
              <button
                onClick={() => setActiveFrameIndex(bestFrameIndex)}
                className="relative shrink-0 rounded-md overflow-hidden transition-all"
                style={{
                  width: 72,
                  height: 48,
                  border: activeIdx === bestFrameIndex
                    ? "2px solid var(--sf-yellow)"
                    : "2px solid var(--sf-lime)",
                  opacity: activeIdx === bestFrameIndex ? 1 : 0.8,
                }}
              >
                <img
                  src={frameUrl(object.segmented_reference_path!)}
                  alt={`${object.object_name} segmented`}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                <span
                  className="absolute top-0.5 right-0.5 text-[7px] font-bold px-1 rounded"
                  style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "var(--sf-lime)" }}
                >
                  SAM3
                </span>
              </button>
            </div>
          </div>
        )}

        {/* All reference frames (collapsible) */}
        {allFrames.length > 1 && (
          <div className="shrink-0">
            <button
              onClick={() => setShowAllFrames((v) => !v)}
              className="flex items-center gap-1.5 mb-1.5 transition-colors"
              style={{ color: "#666" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#aaa")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: showAllFrames ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="text-[10px] font-bold">
                ALL FRAMES ({allFrames.length})
              </span>
            </button>
            {showAllFrames && (
              <div className="overflow-x-auto">
                <div className="flex gap-1.5 pb-1">
                  {allFrames.map((fp, i) => {
                    const isActive = activeIdx === i;
                    const isSegmentedIdx = i === bestFrameIndex && hasSegmented;
                    const thumbSrc = isSegmentedIdx && object.segmented_reference_path
                      ? frameUrl(object.segmented_reference_path)
                      : frameUrl(fp);
                    return (
                      <button
                        key={fp}
                        onClick={() => setActiveFrameIndex(i)}
                        className="relative shrink-0 rounded-md overflow-hidden transition-all"
                        style={{
                          width: 64,
                          height: 42,
                          border: isActive
                            ? "2px solid var(--sf-yellow)"
                            : isSegmentedIdx
                              ? "2px solid var(--sf-lime)"
                              : "2px solid #333",
                          opacity: isActive ? 1 : 0.65,
                        }}
                      >
                        <img
                          src={thumbSrc}
                          alt={`Frame ${i + 1}`}
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                        {isSegmentedIdx && (
                          <span
                            className="absolute top-0 right-0 text-[6px] font-bold px-0.5 rounded-bl"
                            style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "var(--sf-lime)" }}
                          >
                            SAM3
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Large frame viewer */}
        <div className="relative flex-1 flex items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: "#111" }}>
          {displayPath ? (
            <div className="relative">
              <img
                src={frameUrl(displayPath)}
                alt={`${object.object_name} frame ${activeIdx + 1}`}
                className="max-w-full max-h-[55vh] rounded-lg object-contain"
                draggable={false}
              />
            </div>
          ) : (
            <div className="text-sm" style={{ color: "#444" }}>
              No reference frames available
            </div>
          )}

          {/* Bottom bar: info + segmented/original toggle */}
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <div
              className="text-[10px] font-medium px-2 py-1 rounded-md"
              style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "#888" }}
            >
              Frame {activeIdx + 1} of {allFrames.length}
              {object.visual_cues ? ` · ${object.visual_cues}` : ""}
            </div>
            {isOnSegmentedFrame && (
              <button
                onClick={() => setShowSegmented((v) => !v)}
                className="text-[10px] font-bold px-2 py-1 rounded-md transition-colors"
                style={{
                  backgroundColor: showSegmented ? "var(--sf-lime)" : "rgba(255,255,255,0.1)",
                  color: showSegmented ? "var(--sf-black)" : "#888",
                }}
              >
                {showSegmented ? "Segmented" : "Original"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
