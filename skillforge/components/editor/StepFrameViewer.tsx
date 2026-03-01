"use client";
import { useRef, useCallback, useState, useEffect } from "react";
import { useWorkflowStore, selectedStep } from "@/store/workflow-store";
import { frameUrl, videoUrl } from "@/lib/constants";
import { StepVideoOverlay } from "@/components/player/StepVideoOverlay";

type ViewTab = "frames" | "video";

const SEGMENT_COLORS = [
  { border: "#FFC412", fill: "rgba(255,196,18,0.18)" },
  { border: "#00FF80", fill: "rgba(0,255,128,0.18)" },
  { border: "#00C8FF", fill: "rgba(0,200,255,0.18)" },
  { border: "#FF64FF", fill: "rgba(255,100,255,0.18)" },
  { border: "#FF5050", fill: "rgba(255,80,80,0.18)" },
  { border: "#648CFF", fill: "rgba(100,140,255,0.18)" },
  { border: "#E879F9", fill: "rgba(232,121,249,0.18)" },
  { border: "#34D399", fill: "rgba(52,211,153,0.18)" },
];

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [tab, setTab] = useState<ViewTab>("frames");
  const [showSegmented, setShowSegmented] = useState(true);

  const segments = step ? segmentsByStep[step.id] ?? [] : [];
  const isSegmenting = step ? segmentingStepId === step.id : false;

  const currentFramePath = step
    ? activeFramePath[step.id] ?? step.key_frame_path
    : null;

  const currentFrame = step?.frames?.find((f) => f.frame_path === currentFramePath);
  const hasSegmentedView = !!(currentFrame?.object_detected && currentFrame?.segmented_frame_path);

  const displayFramePath =
    showSegmented && hasSegmentedView
      ? currentFrame!.segmented_frame_path!
      : currentFramePath;

  useEffect(() => {
    if (tab !== "video" || !videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play().catch((err: unknown) => console.warn("[StepFrameViewer] Video autoplay blocked:", err));
  }, [tab, step?.id]);

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
  const detectedFrames = frames.filter((f) => f.object_detected);
  const [showAllFrames, setShowAllFrames] = useState(false);

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
          {/* SAM3-detected frames (always visible) */}
          {detectedFrames.length > 0 && (
            <div className="shrink-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--sf-lime)" }} />
                <span className="text-[10px] font-bold" style={{ color: "var(--sf-lime)" }}>
                  SAM3 DETECTED ({detectedFrames.length})
                </span>
              </div>
              <div className="overflow-x-auto">
                <div className="flex gap-1.5 pb-1">
                  {detectedFrames.map((f) => {
                    const isActive = currentFramePath === f.frame_path;
                    const thumbSrc = f.segmented_frame_path
                      ? frameUrl(f.segmented_frame_path)
                      : frameUrl(f.frame_path);
                    return (
                      <button
                        key={f.id}
                        onClick={() => setActiveFrame(step.id, f.frame_path)}
                        className="relative shrink-0 rounded-md overflow-hidden transition-all"
                        style={{
                          width: 72,
                          height: 48,
                          border: isActive
                            ? "2px solid var(--sf-yellow)"
                            : "2px solid var(--sf-lime)",
                          opacity: isActive ? 1 : 0.8,
                        }}
                      >
                        <img
                          src={thumbSrc}
                          alt={`Frame ${f.timestamp_ms}ms`}
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
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* All frames (collapsible) */}
          {frames.length > 1 && (
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
                  ALL FRAMES ({frames.length})
                </span>
              </button>
              {showAllFrames && (
                <div className="overflow-x-auto">
                  <div className="flex gap-1.5 pb-1">
                    {frames.map((f) => {
                      const isActive = currentFramePath === f.frame_path;
                      const thumbSrc =
                        f.object_detected && f.segmented_frame_path
                          ? frameUrl(f.segmented_frame_path)
                          : frameUrl(f.frame_path);
                      return (
                        <button
                          key={f.id}
                          onClick={() => setActiveFrame(step.id, f.frame_path)}
                          className="relative shrink-0 rounded-md overflow-hidden transition-all"
                          style={{
                            width: 64,
                            height: 42,
                            border: isActive
                              ? "2px solid var(--sf-yellow)"
                              : f.object_detected
                                ? "2px solid var(--sf-lime)"
                                : f.is_key_frame
                                  ? "2px solid var(--sf-purple)"
                                  : "2px solid #333",
                            opacity: isActive ? 1 : 0.65,
                          }}
                        >
                          <img
                            src={thumbSrc}
                            alt={`Frame ${f.timestamp_ms}ms`}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                          {f.object_detected && (
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

          {/* Frame viewer — pre-rendered segmented image */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: "#111" }}>
            {displayFramePath ? (
              <div className="relative cursor-crosshair" onClick={handleFrameClick}>
                <img
                  ref={imgRef}
                  src={frameUrl(displayFramePath)}
                  alt={`Step ${step.step_number} frame`}
                  className="max-w-full max-h-[55vh] rounded-lg object-contain"
                  draggable={false}
                />

                {/* Manual SAM3 segment overlays (click-to-segment) */}
                {segments.map((seg, i) => {
                  const palette = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
                  return (
                    <div
                      key={i}
                      className="absolute pointer-events-none"
                      style={{
                        left: `${seg.bbox[0] * 100}%`,
                        top: `${seg.bbox[1] * 100}%`,
                        width: `${(seg.bbox[2] - seg.bbox[0]) * 100}%`,
                        height: `${(seg.bbox[3] - seg.bbox[1]) * 100}%`,
                        border: `2px solid ${palette.border}`,
                        borderRadius: 4,
                        backgroundColor: palette.fill,
                        boxShadow: `0 0 8px ${palette.border}40`,
                      }}
                    >
                      <span
                        className="absolute -top-5 left-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: palette.border, color: "#000" }}
                      >
                        {seg.score ? `${Math.round(seg.score * 100)}%` : `#${i + 1}`}
                      </span>
                    </div>
                  );
                })}

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

            {/* Bottom bar: hint + segmented/original toggle */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <div
                className="text-[10px] font-medium px-2 py-1 rounded-md"
                style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "#888" }}
              >
                Click on frame to add SAM3 segmentation
              </div>
              {hasSegmentedView && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSegmented((v) => !v);
                  }}
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
      ) : (
        /* Video tab */
        <div className="flex-1 flex items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: "#111" }}>
          {step.video_path ? (
            <div className="relative">
              <video
                ref={videoRef}
                key={step.video_path}
                src={videoUrl(step.video_path)}
                controls
                autoPlay
                muted
                className="max-w-full max-h-[60vh] rounded-lg"
              />
              <StepVideoOverlay videoRef={videoRef} step={step} />
            </div>
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
