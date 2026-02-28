"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { renderHandLandmarks } from "@/lib/annotation-renderer";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useARStream } from "@/hooks/useARStream";
import { useMicLevel } from "@/hooks/useMicLevel";
import type { DetectMode, DetectionResult } from "@/hooks/useLiveDetect";
import { useSam3Detect, type Sam3Result } from "@/hooks/useSam3Detect";
import { useMediaPipeDetect } from "@/hooks/useMediaPipeDetect";
import { useDoubleTapDetection } from "@/hooks/useDoubleTapDetection";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { computePinchState } from "@/lib/pinch-detection";
import { CameraFeed } from "@/components/camera/CameraFeed";
import { DetectorSidebar } from "@/components/live-detect/DetectorSidebar";
import { PinchIndicator } from "@/components/live-detect/PinchIndicator";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const SAM3_COLORS = [
  "rgba(0, 255, 128, 0.45)",
  "rgba(0, 200, 255, 0.45)",
  "rgba(255, 100, 255, 0.45)",
  "rgba(255, 200, 0, 0.45)",
  "rgba(255, 80, 80, 0.45)",
  "rgba(100, 140, 255, 0.45)",
];

const SAM3_STROKE_COLORS = [
  "#00FF80", "#00C8FF", "#FF64FF", "#FFC800", "#FF5050", "#648CFF",
];

export default function LiveDetectPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const fpsCounterRef = useRef({ frames: 0, last: Date.now() });

  const [modes, setModes] = useState<Set<DetectMode>>(new Set(["hands"]));
  const [textPrompt, setTextPrompt] = useState("");
  const [mpResult, setMpResult] = useState<{ hands: DetectionResult["hands"] } | null>(null);
  const [sam3Result, setSam3Result] = useState<Sam3Result | null>(null);
  const sam3MaskCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const [hasReceivedResult, setHasReceivedResult] = useState(false);
  const [fps, setFps] = useState(0);
  const [sam3IntervalMs, setSam3IntervalMs] = useState(500);
  const [arStreamEnabled, setArStreamEnabled] = useState(false);

  const { videoRef, isActive, error, start, stop } = useCameraStream();
  const { connectionStatus: arConnectionStatus, lastAckTs: arLastAckTs } = useARStream({
    videoRef,
    enabled: arStreamEnabled && isActive,
    targetFps: 12,
  });
  const { micLevel, hasMic, startMic, stopMic } = useMicLevel();

  const toggleMode = (mode: DetectMode) => {
    setModes((prev) => {
      const next = new Set(prev);
      next.has(mode) ? next.delete(mode) : next.add(mode);
      return next;
    });
  };

  const { mpLoading, mpError } = useMediaPipeDetect({
    videoRef,
    handsEnabled: modes.has("hands"),
    objectsEnabled: false,
    enabled: isActive,
    onResult: (r) => {
      setMpResult({ hands: r.hands });
      setHasReceivedResult(true);
    },
  });

  useSam3Detect({
    videoRef,
    textPrompt,
    intervalMs: sam3IntervalMs,
    enabled: isActive && modes.has("sam3") && textPrompt.length > 0,
    onResult: (r: Sam3Result) => {
      setSam3Result(r);
      setHasReceivedResult(true);
      const cache = sam3MaskCacheRef.current;
      for (const seg of r.sam3_segments ?? []) {
        if (!cache.has(seg.mask_base64)) {
          const bytes = Uint8Array.from(atob(seg.mask_base64), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: "image/png" });
          createImageBitmap(blob).then((rawBmp) => {
            const oc = document.createElement("canvas");
            oc.width = rawBmp.width;
            oc.height = rawBmp.height;
            const octx = oc.getContext("2d")!;
            octx.drawImage(rawBmp, 0, 0);
            const imgData = octx.getImageData(0, 0, oc.width, oc.height);
            const d = imgData.data;
            for (let j = 0; j < d.length; j += 4) {
              d[j + 3] = d[j]; // grayscale value → alpha channel
            }
            octx.putImageData(imgData, 0, 0);
            createImageBitmap(oc).then((alphaBmp) => cache.set(seg.mask_base64, alphaBmp));
          });
        }
      }
    },
  });

  const result: DetectionResult | null =
    mpResult || sam3Result
      ? {
          hands: mpResult?.hands ?? null,
          sam3_segments: sam3Result?.sam3_segments ?? [],
          processing_ms: sam3Result?.processing_ms ?? 0,
        }
      : null;

  const pinchState = computePinchState(result?.hands ?? null);

  const lastSkipRewindAtRef = useRef<number>(0);
  const SKIP_REWIND_COOLDOWN_MS = 1000;

  const skipForward = useCallback(() => {
    const now = Date.now();
    if (now - lastSkipRewindAtRef.current < SKIP_REWIND_COOLDOWN_MS) return;
    lastSkipRewindAtRef.current = now;
    // Placeholder: wire to next step when integrated (e.g. learn page)
    console.log("Skipping step");
  }, []);
  const skipBackward = useCallback(() => {
    const now = Date.now();
    if (now - lastSkipRewindAtRef.current < SKIP_REWIND_COOLDOWN_MS) return;
    lastSkipRewindAtRef.current = now;
    // Placeholder: wire to previous step when integrated (e.g. learn page)
    console.log("Rewinding step");
  }, []);

  useDoubleTapDetection(
    isActive && modes.has("hands") ? result?.hands ?? null : null,
    { onSkipForward: skipForward, onSkipBackward: skipBackward }
  );

  const voice = useVoiceCommands({
    onNextStep: skipForward,
    onPreviousStep: skipBackward,
    onFinish: () => {},
    enabled: isActive,
  });

  const renderLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { animFrameRef.current = requestAnimationFrame(renderLoop); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = performance.now();

    if (result) {
      if (result.hands?.hands?.length) {
        renderHandLandmarks(ctx, result.hands.hands, canvas.width, canvas.height, t);
        if (result.hands.pointing_at) {
          const px = (result.hands.pointing_at.x / 100) * canvas.width;
          const py = (result.hands.pointing_at.y / 100) * canvas.height;
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.005);
          ctx.save();
          ctx.beginPath();
          ctx.arc(px, py, 10 + pulse * 5, 0, Math.PI * 2);
          ctx.strokeStyle = "#3B82F6";
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.8;
          ctx.stroke();
          ctx.restore();
        }
      }

      // SAM3 segmentation masks
      if (result.sam3_segments?.length) {
        const maskCache = sam3MaskCacheRef.current;
        result.sam3_segments.forEach((seg, i) => {
          const bmp = maskCache.get(seg.mask_base64);
          if (bmp) {
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.globalCompositeOperation = "source-over";
            // Draw the mask as a tinted overlay
            const offscreen = document.createElement("canvas");
            offscreen.width = canvas.width;
            offscreen.height = canvas.height;
            const offCtx = offscreen.getContext("2d")!;
            offCtx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
            offCtx.globalCompositeOperation = "source-in";
            offCtx.fillStyle = SAM3_COLORS[i % SAM3_COLORS.length];
            offCtx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(offscreen, 0, 0);
            ctx.restore();
          }

          // Bounding box + label
          const [bx1, by1, bx2, by2] = seg.bbox;
          const sx = bx1 * canvas.width, sy = by1 * canvas.height;
          const sw = (bx2 - bx1) * canvas.width, sh = (by2 - by1) * canvas.height;
          const strokeColor = SAM3_STROKE_COLORS[i % SAM3_STROKE_COLORS.length];
          ctx.save();
          ctx.shadowColor = strokeColor;
          ctx.shadowBlur = 6;
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 3;
          ctx.globalAlpha = 1;
          ctx.strokeRect(sx, sy, sw, sh);
          ctx.shadowBlur = 0;
          const label = `${textPrompt} ${Math.round(seg.score * 100)}%`;
          ctx.font = "bold 14px system-ui";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = strokeColor;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(sx, sy - 24, tw + 12, 24);
          ctx.fillStyle = "#fff";
          ctx.globalAlpha = 1;
          ctx.fillText(label, sx + 6, sy - 7);
          ctx.restore();
        });
      }
    }

    const now = Date.now();
    fpsCounterRef.current.frames++;
    if (now - fpsCounterRef.current.last >= 1000) {
      setFps(fpsCounterRef.current.frames);
      fpsCounterRef.current = { frames: 0, last: now };
    }

    animFrameRef.current = requestAnimationFrame(renderLoop);
  }, [result, textPrompt, videoRef]);

  useEffect(() => {
    if (isActive) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isActive, renderLoop]);

  const handleStart = async () => {
    await start();
    startMic();
  };

  useEffect(() => {
    if (isActive) {
      voice.start();
    } else {
      voice.stop();
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStop = () => {
    stop();
    stopMic();
    setMpResult(null);
    setSam3Result(null);
    sam3MaskCacheRef.current.clear();
    setHasReceivedResult(false);
    setFps(0);
  };

  const modeBadges = [
    ...(modes.has("hands") ? [{ label: "Hands", color: "rgba(245,158,11,0.8)" }] : []),
    ...(modes.has("sam3") && textPrompt ? [{ label: `SAM3: ${textPrompt}`, color: "rgba(168,85,247,0.8)" }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--sf-black)", color: "var(--sf-white)" }}>
      {/* Header */}
      <header
        className="px-6 py-3 flex items-center gap-4 shrink-0"
        style={{ borderBottom: "1px solid #222" }}
      >
        <Link
          href="/"
          className="text-sm font-medium transition-colors"
          style={{ color: "#777" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--sf-orange)")}
          onMouseLeave={e => (e.currentTarget.style.color = "#777")}
        >
          ← Home
        </Link>
        <span style={{ color: "#333" }}>|</span>
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: isActive ? "var(--sf-lime)" : "#444" }}
          />
          <span className="text-sm font-bold" style={{ color: isActive ? "var(--sf-white)" : "#777" }}>
            Live Camera Detection
          </span>
          {isActive && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-bold animate-pulse"
              style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
            >
              LIVE
            </span>
          )}
        </div>
        {isActive && (
          <div className="ml-auto flex items-center gap-4 text-xs" style={{ color: "#555" }}>
            {mpLoading && <span className="animate-pulse" style={{ color: "var(--sf-yellow)" }}>Loading model…</span>}
            <span>{fps} fps</span>
            {sam3Result && modes.has("sam3") && (
              <span>{sam3Result.processing_ms}ms (SAM3)</span>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <DetectorSidebar
          modes={modes}
          onToggleMode={toggleMode}
          textPrompt={textPrompt}
          onTextPromptChange={setTextPrompt}
          isRunning={isActive}
          mpLoading={mpLoading}
          sam3IntervalMs={sam3IntervalMs}
          onSam3IntervalChange={setSam3IntervalMs}
          stats={{
            handCount: result?.hands?.hand_count ?? 0,
            sam3Count: result?.sam3_segments?.length ?? 0,
            hasReceivedResult,
          }}
          micLevel={micLevel}
          hasMic={hasMic}
          arStreamEnabled={arStreamEnabled}
          onARStreamToggle={setArStreamEnabled}
          arConnectionStatus={arConnectionStatus}
          arLastAckTs={arLastAckTs}
        />

        <main className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden">
          {!isActive ? (
            <div className="text-center max-w-sm">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-6"
                style={{ backgroundColor: "#111", border: "1px solid #2a2a2a" }}
              >
                📷
              </div>
              <h2
                className="font-black mb-2"
                style={{ fontSize: "1.5rem", letterSpacing: "-0.03em", color: "var(--sf-white)" }}
              >
                Live Camera Detection
              </h2>
              <p className="text-sm mb-8 leading-relaxed" style={{ color: "#777" }}>
                Hand tracking runs on-device in real-time. SAM 3 segments objects
                by concept on a cloud GPU.
              </p>
              {error && <ErrorBanner message={error} className="mb-4" />}
              {mpError && <ErrorBanner message={`MediaPipe: ${mpError}`} className="mb-4" />}
              <button
                onClick={handleStart}
                className="px-8 py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-80"
                style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
              >
                Enable Camera
              </button>
            </div>
          ) : (
            <div className="w-full max-w-6xl">
              <CameraFeed
                videoRef={videoRef}
                canvasRef={canvasRef}
                modeBadges={modeBadges}
                footer={
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-xs" style={{ color: "#555" }}>
                          {[
                            modes.has("hands") && "Hands: real-time",
                            modes.has("sam3") && `SAM3: every ${sam3IntervalMs}ms`,
                          ].filter(Boolean).join(" · ")}
                          {" · "}{fps} render fps
                          {arStreamEnabled && (
                            <span className="ml-2">
                              · AR: {arConnectionStatus === "open" ? "connected" : arConnectionStatus === "connecting" ? "connecting…" : arConnectionStatus === "error" ? "error" : "disconnected"}
                              {arLastAckTs != null && " · Pose received"}
                            </span>
                          )}
                        </p>
                        {isActive && modes.has("hands") && (
                          <PinchIndicator
                            leftPressed={pinchState.leftPressed}
                            rightPressed={pinchState.rightPressed}
                          />
                        )}
                      </div>
                      <button
                        onClick={handleStop}
                        className="text-xs px-4 py-2 rounded-lg font-bold transition-opacity hover:opacity-80"
                        style={{ backgroundColor: "var(--sf-orange)", color: "var(--sf-black)" }}
                      >
                        Stop Camera
                      </button>
                    </div>
                  </div>
                }
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
