"use client";
import { useRef, useCallback, useState } from "react";
import { useWorkflowStore, selectedStep } from "@/store/workflow-store";
import { frameUrl, videoUrl } from "@/lib/constants";

type ViewTab = "frames" | "video";

export function StepFrameViewer() {
  const store = useWorkflowStore();
  const step = selectedStep(store);
  const {
    segmentsByStep,
    segmentingStepId,
    activeFramePath,
    addSegment,
    setActiveFrame,
  } = store;

  const imgRef = useRef<HTMLImageElement>(null);
  const [tab, setTab] = useState<ViewTab>("frames");

  const segments = step ? segmentsByStep[step.id] ?? [] : [];
  const isSegmenting = step ? segmentingStepId === step.id : false;

  const currentFramePath = step
    ? activeFramePath[step.id] ?? step.key_frame_path
    : null;

  const handleFrameClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!step) return;
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

  if (!step) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm" style={{ color: "#444" }}>Select a step to view</div>
      </div>
    );
  }

  const hasVideo = !!step.video_path;
  const frames = step.frames ?? [];

  return (
    <div className="flex-1 flex flex-col gap-3 overflow-hidden">
      {/* Tab toggle */}
      {hasVideo && (
        <div className="flex gap-1 shrink-0">
          <TabButton active={tab === "frames"} onClick={() => setTab("frames")}>
            Key Frames
          </TabButton>
          <TabButton active={tab === "video"} onClick={() => setTab("video")}>
            Video
          </TabButton>
        </div>
      )}

      {/* Main content */}
      {tab === "frames" ? (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          {/* Frame viewer with SAM3 */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: "#111" }}>
            {currentFramePath ? (
              <div className="relative cursor-crosshair" onClick={handleFrameClick}>
                <img
                  ref={imgRef}
                  src={frameUrl(currentFramePath)}
                  alt={`Step ${step.step_number} frame`}
                  className="max-w-full max-h-[55vh] rounded-lg object-contain"
                  draggable={false}
                />

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

                {/* SAM3 segment overlays */}
                {segments.map((seg, i) => (
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

                {isSegmenting && (
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

          {/* Filmstrip */}
          {frames.length > 1 && (
            <div className="shrink-0 overflow-x-auto">
              <div className="flex gap-1.5 pb-1">
                {frames.map((f) => {
                  const isActive = currentFramePath === f.frame_path;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setActiveFrame(step.id, f.frame_path)}
                      className="shrink-0 rounded-md overflow-hidden transition-all"
                      style={{
                        width: 72,
                        height: 48,
                        border: isActive
                          ? "2px solid var(--sf-yellow)"
                          : f.is_key_frame
                            ? "2px solid var(--sf-purple)"
                            : "2px solid #333",
                        opacity: isActive ? 1 : 0.7,
                      }}
                    >
                      <img
                        src={frameUrl(f.frame_path)}
                        alt={`Frame ${f.timestamp_ms}ms`}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Video tab */
        <div className="flex-1 flex items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: "#111" }}>
          {step.video_path ? (
            <video
              key={step.video_path}
              src={videoUrl(step.video_path)}
              controls
              className="max-w-full max-h-[60vh] rounded-lg"
            />
          ) : (
            <div className="text-sm" style={{ color: "#444" }}>No video available</div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
      style={{
        backgroundColor: active ? "rgba(255,255,255,0.1)" : "transparent",
        color: active ? "var(--sf-white)" : "#555",
        border: active ? "1px solid #333" : "1px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
