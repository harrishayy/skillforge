"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { renderHandLandmarks } from "@/lib/annotation-renderer";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useARStream } from "@/hooks/useARStream";
import { useMicLevel } from "@/hooks/useMicLevel";
import { useLiveDetect, type DetectMode, type DetectionResult } from "@/hooks/useLiveDetect";
import { useMediaPipeDetect } from "@/hooks/useMediaPipeDetect";
import { useDoubleTapDetection } from "@/hooks/useDoubleTapDetection";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { computePinchState } from "@/lib/pinch-detection";
import { CameraFeed } from "@/components/camera/CameraFeed";
import { DetectorSidebar } from "@/components/live-detect/DetectorSidebar";
import { PinchIndicator } from "@/components/live-detect/PinchIndicator";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const YOLO_COLORS = [
  "#3B82F6", "#8B5CF6", "#10B981", "#F59E0B",
  "#EF4444", "#06B6D4", "#EC4899", "#14B8A6",
];

export default function LiveDetectPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const fpsCounterRef = useRef({ frames: 0, last: Date.now() });

  const [modes, setModes] = useState<Set<DetectMode>>(new Set(["hands"]));
  const [textPrompt, setTextPrompt] = useState("");
  const [mpResult, setMpResult] = useState<{
    hands: DetectionResult["hands"];
    yolo_detections: DetectionResult["yolo_detections"];
  } | null>(null);
  const [backendResult, setBackendResult] = useState<DetectionResult | null>(null);
  const [hasReceivedResult, setHasReceivedResult] = useState(false);
  const [fps, setFps] = useState(0);
  const [intervalMs, setIntervalMs] = useState(33);
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
    objectsEnabled: modes.has("yolo"),
    enabled: isActive,
    onResult: (r) => {
      setMpResult({ hands: r.hands, yolo_detections: r.mp_detections });
      setHasReceivedResult(true);
    },
  });

  useLiveDetect({
    videoRef,
    modes: new Set(["custom"] as DetectMode[]),
    textPrompt,
    intervalMs,
    enabled: isActive && modes.has("custom"),
    onResult: (r) => {
      setBackendResult(r);
      setHasReceivedResult(true);
    },
  });

  const result: DetectionResult | null =
    mpResult || backendResult
      ? {
          hands: mpResult?.hands ?? null,
          yolo_detections: mpResult?.yolo_detections ?? [],
          custom_detection: backendResult?.custom_detection ?? null,
          processing_ms: backendResult?.processing_ms ?? 0,
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

      result.yolo_detections.forEach((det, i) => {
        const color = YOLO_COLORS[i % YOLO_COLORS.length];
        const x = (det.bbox_x / 100) * canvas.width;
        const y = (det.bbox_y / 100) * canvas.height;
        const bw = (det.bbox_width / 100) * canvas.width;
        const bh = (det.bbox_height / 100) * canvas.height;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;
        ctx.strokeRect(x, y, bw, bh);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = color;
        const label = `${det.class} ${Math.round(det.confidence * 100)}%`;
        ctx.font = "bold 12px system-ui";
        const tw = ctx.measureText(label).width;
        ctx.fillRect(x, y - 18, tw + 8, 18);
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 1;
        ctx.fillText(label, x + 4, y - 4);
        ctx.restore();
      });

      if (result.custom_detection?.bbox) {
        const [cx, cy, cw, ch] = result.custom_detection.bbox;
        const x = cx * canvas.width, y = cy * canvas.height;
        const bw = cw * canvas.width, bh = ch * canvas.height;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.004);
        ctx.save();
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 3 + pulse;
        ctx.shadowColor = "#f97316";
        ctx.shadowBlur = 10 + pulse * 5;
        ctx.strokeRect(x, y, bw, bh);
        const label = `${textPrompt} ${Math.round((result.custom_detection.confidence ?? 0) * 100)}%`;
        ctx.shadowBlur = 0;
        ctx.font = "bold 12px system-ui";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "#f97316";
        ctx.globalAlpha = 0.9;
        ctx.fillRect(x, y - 18, tw + 8, 18);
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 1;
        ctx.fillText(label, x + 4, y - 4);
        ctx.restore();
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
    setBackendResult(null);
    setHasReceivedResult(false);
    setFps(0);
  };

  const modeBadges = [
    ...(modes.has("hands") ? [{ label: "Hands", color: "rgba(245,158,11,0.8)" }] : []),
    ...(modes.has("yolo") ? [{ label: "Objects", color: "rgba(59,130,246,0.8)" }] : []),
    ...(modes.has("custom") && textPrompt ? [{ label: textPrompt, color: "rgba(249,115,22,0.8)" }] : []),
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
            {backendResult && modes.has("custom") && (
              <span>{backendResult.processing_ms}ms (custom)</span>
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
          intervalMs={intervalMs}
          onIntervalChange={setIntervalMs}
          isRunning={isActive}
          mpLoading={mpLoading}
          stats={{
            handCount: result?.hands?.hand_count ?? 0,
            yoloCount: result?.yolo_detections.length ?? 0,
            customFound: !!result?.custom_detection,
            yoloDetections: result?.yolo_detections ?? [],
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
                Hand tracking and object detection run directly on your device in real-time —
                no upload delay. Custom prompt uses AI vision on the backend.
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
            <div className="w-full max-w-4xl">
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
                            modes.has("yolo") && "Objects: real-time",
                            modes.has("custom") && `Custom: every ${intervalMs}ms`,
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
