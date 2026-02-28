"use client";
import { useRef, useCallback, useState, useEffect } from "react";
import { useWorkflowStore, selectedStep } from "@/store/workflow-store";
import { frameUrl, videoUrl } from "@/lib/constants";
import type { ClickTarget } from "@/types";

const MASK_COLORS = [
  "rgba(0, 255, 128, 0.45)",
  "rgba(0, 200, 255, 0.45)",
  "rgba(255, 100, 255, 0.45)",
  "rgba(255, 200, 0, 0.45)",
];
const MASK_STROKE = ["#00FF80", "#00C8FF", "#FF64FF", "#FFC800"];

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
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<ViewTab>("frames");

  const segments = step ? segmentsByStep[step.id] ?? [] : [];
  const isSegmenting = step ? segmentingStepId === step.id : false;

  const currentFramePath = step
    ? activeFramePath[step.id] ?? step.key_frame_path
    : null;

  const clickTargets = step?.click_targets ?? [];

  // Redraw masks when click_targets or current frame changes
  useEffect(() => {
    if (!step) return;
    const timer = setTimeout(() => {
      drawMasks(imgRef.current, maskCanvasRef.current, clickTargets, currentFramePath);
    }, 50);
    return () => clearTimeout(timer);
  }, [clickTargets, currentFramePath, step]);

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
                            : "2px solid var(--sf-lime)",
                          opacity: isActive ? 1 : 0.8,
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
                      return (
                        <button
                          key={f.id}
                          onClick={() => setActiveFrame(step.id, f.frame_path)}
                          className="shrink-0 rounded-md overflow-hidden transition-all"
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
          )}

          {/* Frame viewer with SAM3 mask overlay */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: "#111" }}>
            {currentFramePath ? (
              <div className="relative cursor-crosshair" onClick={handleFrameClick}>
                <img
                  ref={imgRef}
                  src={frameUrl(currentFramePath)}
                  alt={`Step ${step.step_number} frame`}
                  className="max-w-full max-h-[55vh] rounded-lg object-contain"
                  draggable={false}
                  onLoad={() => drawMasks(imgRef.current, maskCanvasRef.current, step.click_targets, currentFramePath)}
                />

                <canvas
                  ref={maskCanvasRef}
                  className="absolute top-0 left-0 pointer-events-none rounded-lg"
                />

                {/* Manual SAM3 segment overlays (click-to-segment) */}
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

/**
 * Renders SAM3 segmentation masks onto a canvas overlaid on the frame image.
 * Uses the same mask-to-alpha technique as the live detection page:
 * loads mask PNG, uses grayscale values as alpha, composites with a color fill.
 */
async function drawMasks(
  img: HTMLImageElement | null,
  canvas: HTMLCanvasElement | null,
  clickTargets: ClickTarget[],
  currentFramePath: string | null,
) {
  if (!img || !canvas) return;

  const w = img.clientWidth;
  const h = img.clientHeight;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const masksToRender = clickTargets.filter(
    (ct) => ct.mask_path && (!ct.frame_path || !currentFramePath || ct.frame_path === currentFramePath),
  );
  if (masksToRender.length === 0) return;

  for (let i = 0; i < masksToRender.length; i++) {
    const ct = masksToRender[i];
    try {
      const maskImg = new Image();
      maskImg.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        maskImg.onload = () => resolve();
        maskImg.onerror = () => reject();
        maskImg.src = frameUrl(ct.mask_path!);
      });

      // Convert grayscale mask to alpha channel
      const oc = document.createElement("canvas");
      oc.width = w;
      oc.height = h;
      const octx = oc.getContext("2d")!;
      octx.drawImage(maskImg, 0, 0, w, h);
      const imgData = octx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let j = 0; j < d.length; j += 4) {
        d[j + 3] = d[j]; // grayscale → alpha
      }
      octx.putImageData(imgData, 0, 0);

      // Composite colored mask onto main canvas
      octx.globalCompositeOperation = "source-in";
      octx.fillStyle = MASK_COLORS[i % MASK_COLORS.length];
      octx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(oc, 0, 0);
      ctx.restore();

      // Draw bounding box + label
      const bx = (ct.bbox_x / 100) * w;
      const by = (ct.bbox_y / 100) * h;
      const bw = (ct.bbox_width / 100) * w;
      const bh = (ct.bbox_height / 100) * h;
      const stroke = MASK_STROKE[i % MASK_STROKE.length];

      ctx.save();
      ctx.shadowColor = stroke;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0;

      if (ct.element_text) {
        const label = `${ct.element_text} ${ct.confidence != null ? Math.round(ct.confidence * 100) + "%" : ""}`;
        ctx.font = "bold 12px system-ui";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = stroke;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(bx, by - 20, tw + 10, 20);
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 1;
        ctx.fillText(label, bx + 5, by - 5);
      }
      ctx.restore();
    } catch {
      // mask failed to load — skip
    }
  }
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
