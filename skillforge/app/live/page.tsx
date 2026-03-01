"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { renderHandLandmarks } from "@/lib/annotation-renderer";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useARStream } from "@/hooks/useARStream";
import { useCameraRoomProducer } from "@/hooks/useCameraRoomProducer";
import { useCameraRoomViewer } from "@/hooks/useCameraRoomViewer";
import type { DetectMode, DetectionResult } from "@/hooks/useLiveDetect";
import { useSam3Detect, type Sam3Result } from "@/hooks/useSam3Detect";
import { useMediaPipeDetect } from "@/hooks/useMediaPipeDetect";
import { useDoubleTapDetection } from "@/hooks/useDoubleTapDetection";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { computePhoneGestureState } from "@/lib/phone-gesture-detection";
import { DetectorSidebar } from "@/components/live-detect/DetectorSidebar";
import { PinchIndicator } from "@/components/live-detect/PinchIndicator";
import { ImmersiveOverlay } from "@/components/live-detect/ImmersiveOverlay";
import type { OverlayPanels } from "@/components/live-detect/ImmersiveToolbar";
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
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const sessionParam = searchParams.get("session");
  const hostParam = searchParams.get("host");
  const isCameraOnlyMode = mode === "camera" && !!sessionParam;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const fpsCounterRef = useRef({ frames: 0, last: Date.now() });
  const remoteCanvasRef = useRef<HTMLCanvasElement>(null);

  const [modes, setModes] = useState<Set<DetectMode>>(new Set(["hands"]));
  const [textPrompt, setTextPrompt] = useState("");
  const [mpResult, setMpResult] = useState<{ hands: DetectionResult["hands"] } | null>(null);
  const [sam3Result, setSam3Result] = useState<Sam3Result | null>(null);
  const sam3MaskCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const [hasReceivedResult, setHasReceivedResult] = useState(false);
  const [fps, setFps] = useState(0);
  const [sam3IntervalMs, setSam3IntervalMs] = useState(500);
  const [arStreamEnabled, setArStreamEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [gesturesEnabled, setGesturesEnabled] = useState(true);
  const [isImmersive, setIsImmersive] = useState(true);
  const [overlayPanels, setOverlayPanels] = useState<OverlayPanels>({
    options: true,
    chat: true,
    stats: true,
  });
  const [cameraSource, setCameraSource] = useState<"local" | "remote">("local");
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [remoteDimensions, setRemoteDimensions] = useState<{ w: number; h: number } | null>(null);
  const [focusReticle, setFocusReticle] = useState<{ left: number; top: number } | null>(null);
  const focusReticleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleOverlayPanel = useCallback((panel: keyof OverlayPanels) => {
    setOverlayPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  const cameraOnlyConstraints: MediaTrackConstraints = isCameraOnlyMode
    ? {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
        facingMode: { ideal: "environment" },
        focusMode: "continuous",
        exposureMode: "continuous",
        whiteBalanceMode: "continuous",
      }
    : {};

  const { videoRef, stream, isActive, error, start, stop, switchCamera, facingMode } = useCameraStream({
    constraints: cameraOnlyConstraints,
  });
  const { connectionStatus: arConnectionStatus, lastAckTs: arLastAckTs } = useARStream({
    videoRef,
    enabled: cameraSource === "local" && arStreamEnabled && isActive,
    targetFps: 12,
  });

  const { connectionStatus: viewerStatus, remoteFrame, remoteDetection } = useCameraRoomViewer({
    sessionId: remoteSessionId,
    enabled: cameraSource === "remote" && !!remoteSessionId,
  });
  const { connectionStatus: producerStatus } = useCameraRoomProducer({
    videoRef,
    sessionId: isCameraOnlyMode ? sessionParam : null,
    host: isCameraOnlyMode ? hostParam ?? undefined : undefined,
    enabled: isCameraOnlyMode,
    targetFps: 24,
  });

  useEffect(() => {
    return () => {
      if (focusReticleTimeoutRef.current) {
        clearTimeout(focusReticleTimeoutRef.current);
        focusReticleTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isCameraOnlyMode) return;
    const lock = () => {
      try {
        if (typeof screen !== "undefined" && screen.orientation?.lock) {
          screen.orientation.lock("landscape").catch((err: unknown) => console.warn("[Live] Screen orientation lock not supported on this device:", err));
        }
      } catch (err) {
        console.warn("[Live] Screen orientation lock API unavailable:", err);
      }
    };
    lock();
    return () => {
      try {
        if (typeof screen !== "undefined" && screen.orientation?.unlock) {
          screen.orientation.unlock();
        }
      } catch (err) {
        console.warn("[Live] Screen orientation unlock failed:", err);
      }
    };
  }, [isCameraOnlyMode]);

  const handleTapToFocus = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isCameraOnlyMode || cameraSource === "remote" || !stream || !videoRef.current) return;
      const video = videoRef.current;
      const rect = video.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          track
            .applyConstraints({
              advanced: [{ pointsOfInterest: [{ x: nx, y: ny }] } as MediaTrackConstraintSet],
            })
            .catch((err: unknown) => console.warn("[Live] Camera focus constraints not supported:", err));
        } catch (err) {
          console.warn("[Live] Failed to apply tap-to-focus constraints:", err);
        }
      }
      if (focusReticleTimeoutRef.current) clearTimeout(focusReticleTimeoutRef.current);
      setFocusReticle({ left: e.clientX - rect.left, top: e.clientY - rect.top });
      focusReticleTimeoutRef.current = setTimeout(() => {
        focusReticleTimeoutRef.current = null;
        setFocusReticle(null);
      }, 800);
    },
    [isCameraOnlyMode, cameraSource, stream]
  );

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
    enabled: cameraSource === "local" && isActive,
    onResult: (r) => {
      setMpResult({ hands: r.hands });
      setHasReceivedResult(true);
    },
  });

  useSam3Detect({
    videoRef,
    textPrompt,
    intervalMs: sam3IntervalMs,
    enabled: cameraSource === "local" && isActive && modes.has("sam3") && textPrompt.length > 0,
    onResult: (r: Sam3Result) => {
      if (r.sam3_segments.length > 0) setSam3Result(r);
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

  const displayActive =
    (cameraSource === "local" && isActive) || (cameraSource === "remote" && !!remoteSessionId);

  const result: DetectionResult | null =
    cameraSource === "remote"
      ? remoteDetection
      : mpResult || sam3Result
        ? {
            hands: mpResult?.hands ?? null,
            sam3_segments: sam3Result?.sam3_segments ?? [],
            processing_ms: sam3Result?.processing_ms ?? 0,
          }
        : null;

  const gestureState = computePhoneGestureState(result?.hands ?? null);

  const lastSkipRewindAtRef = useRef<number>(0);
  const SKIP_REWIND_COOLDOWN_MS = 1000;

  const skipForward = useCallback(() => {
    const now = Date.now();
    if (now - lastSkipRewindAtRef.current < SKIP_REWIND_COOLDOWN_MS) return;
    lastSkipRewindAtRef.current = now;
    console.log("Skipping step");
  }, []);
  const skipBackward = useCallback(() => {
    const now = Date.now();
    if (now - lastSkipRewindAtRef.current < SKIP_REWIND_COOLDOWN_MS) return;
    lastSkipRewindAtRef.current = now;
    console.log("Rewinding step");
  }, []);

  useDoubleTapDetection(
    displayActive && modes.has("hands") && gesturesEnabled ? result?.hands ?? null : null,
    { onSkipForward: skipForward, onSkipBackward: skipBackward }
  );

  const voice = useVoiceCommands({
    onNextStep: skipForward,
    onPreviousStep: skipBackward,
    onFinish: () => {},
    enabled: displayActive && micEnabled,
  });

  useEffect(() => {
    if (cameraSource !== "remote" || !remoteFrame?.data || !remoteCanvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const rc = remoteCanvasRef.current;
      if (!rc) return;
      rc.width = img.width;
      rc.height = img.height;
      const ctx = rc.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0);
      setRemoteDimensions((prev) =>
        prev?.w === img.width && prev?.h === img.height ? prev : { w: img.width, h: img.height }
      );
    };
    img.src = `data:image/jpeg;base64,${remoteFrame.data}`;
  }, [cameraSource, remoteFrame?.data, remoteFrame?.ts]);

  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    const isRemote = cameraSource === "remote";
    const w = isRemote
      ? remoteCanvasRef.current?.width ?? remoteDimensions?.w ?? 0
      : videoRef.current?.videoWidth ?? 0;
    const h = isRemote
      ? remoteCanvasRef.current?.height ?? remoteDimensions?.h ?? 0
      : videoRef.current?.videoHeight ?? 0;
    if (isRemote && (w === 0 || h === 0)) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    if (!isRemote && (!videoRef.current || videoRef.current.readyState < 2)) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { animFrameRef.current = requestAnimationFrame(renderLoop); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // In remote mode, draw the remote feed onto the main canvas first (then overlays on top).
    // This ensures the phone feed is visible even if the underlay canvas has stacking/opacity quirks.
    if (isRemote && remoteCanvasRef.current && remoteCanvasRef.current.width > 0 && remoteCanvasRef.current.height > 0) {
      ctx.drawImage(remoteCanvasRef.current, 0, 0, w, h);
    }

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

      if (result.sam3_segments?.length) {
        const maskCache = sam3MaskCacheRef.current;
        result.sam3_segments.forEach((seg, i) => {
          const bmp = maskCache.get(seg.mask_base64);
          if (bmp) {
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.globalCompositeOperation = "source-over";
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
  }, [result, textPrompt, videoRef, cameraSource, remoteDimensions]);

  useEffect(() => {
    if (displayActive) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [displayActive, renderLoop]);

  const handleStart = async () => {
    await start();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isImmersive) {
        setIsImmersive(false);
      }
      if (
        e.key === "f" &&
        isActive &&
        !isImmersive &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        setIsImmersive(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, isImmersive]);

  const handleStop = () => {
    if (cameraSource === "remote") {
      setCameraSource("local");
      setRemoteSessionId(null);
      setShowQrModal(false);
      setRemoteDimensions(null);
      setMpResult(null);
      setSam3Result(null);
      setHasReceivedResult(false);
      setFps(0);
    } else {
      stop();
      setIsImmersive(false);
      setMpResult(null);
      setSam3Result(null);
      sam3MaskCacheRef.current.clear();
      setHasReceivedResult(false);
      setFps(0);
    }
  };

  const handleUsePhoneAsCamera = () => {
    setCameraSource("remote");
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    setRemoteSessionId(uuid);
    setShowQrModal(true);
  };

  useEffect(() => {
    if (isCameraOnlyMode) {
      start();
    }
  }, [isCameraOnlyMode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isCameraOnlyMode) {
    const glassBar =
      "bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50";

    if (!isActive) {
      return (
        <div
          className="min-h-screen relative flex flex-col items-center justify-center p-6"
          style={{ backgroundColor: "var(--sf-black)", color: "var(--sf-white)" }}
        >
          <Link
            href="/live"
            className="absolute top-4 left-4 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            ← Back
          </Link>
          <p className="text-center text-sm mb-6" style={{ color: "rgba(255,255,255,0.85)" }}>
            Allow camera to stream to your laptop
          </p>
          <button
            type="button"
            onClick={() => start()}
            className="px-8 py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
          >
            Start camera
          </button>
          {error && (
            <div className={`mt-6 w-full max-w-md px-4 py-3 z-10 ${glassBar}`}>
              <p className="text-xs font-medium" style={{ color: "var(--sf-orange)" }}>
                Camera: {error}
              </p>
              <button
                type="button"
                onClick={() => start()}
                className="mt-3 px-4 py-2 rounded-lg text-xs font-bold"
                style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "var(--sf-white)" }}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        className="min-h-screen relative flex flex-col"
        style={{ backgroundColor: "var(--sf-black)", color: "var(--sf-white)" }}
      >
        {/* Full-bleed camera feed */}
        <div className="absolute inset-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>

        {/* Camera error bar (when active but error set e.g. after flip failure) */}
        {error && (
          <div
            className={`absolute top-4 left-4 right-4 z-20 mt-[4.5rem] px-4 py-3 flex items-center justify-between gap-3 ${glassBar}`}
          >
            <span className="text-xs font-medium" style={{ color: "var(--sf-orange)" }}>
              Camera: {error}
            </span>
            <button
              type="button"
              onClick={() => start()}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "var(--sf-white)" }}
            >
              Try again
            </button>
          </div>
        )}

        {/* Top bar: title + status (frosted) */}
        <div
          className={`absolute top-4 left-4 right-4 z-10 px-4 py-3 grid grid-cols-3 items-center gap-2 ${glassBar}`}
        >
          <Link
            href="/live"
            className="text-sm font-medium transition-opacity hover:opacity-80"
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            ← Back
          </Link>
          <span className="text-sm font-bold text-center">Streaming to laptop</span>
          <span
            className="text-xs font-medium text-right"
            style={{
              color:
                producerStatus === "open"
                  ? "var(--sf-lime)"
                  : producerStatus === "error"
                    ? "var(--sf-orange)"
                    : "rgba(255,255,255,0.6)",
            }}
          >
            {producerStatus === "open"
              ? "Connected"
              : producerStatus === "connecting"
                ? "Connecting…"
                : producerStatus === "error"
                  ? "Error"
                  : "Disconnected"}
          </span>
        </div>

        {/* Bottom bar: flip + stop (frosted) */}
        <div
          className={`absolute bottom-4 left-4 right-4 z-10 px-4 py-3 flex items-center justify-center gap-3 ${glassBar}`}
        >
          <button
            type="button"
            onClick={switchCamera}
            className="w-12 h-12 rounded-xl flex items-center justify-center transition-all hover:scale-105"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              color: "var(--sf-white)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
            title={facingMode === "user" ? "Switch to back camera" : "Switch to front camera"}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
              <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <Link
            href="/live"
            className="px-5 py-2.5 rounded-xl font-bold text-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--sf-orange)", color: "var(--sf-black)" }}
          >
            Stop streaming
          </Link>
        </div>
      </div>
    );
  }

  const modeBadges = [
    ...(modes.has("hands") ? [{ label: "Hands", color: "rgba(245,158,11,0.8)" }] : []),
    ...(modes.has("sam3") && textPrompt ? [{ label: `SAM3: ${textPrompt}`, color: "rgba(168,85,247,0.8)" }] : []),
  ];

  const sidebarProps = {
    modes,
    onToggleMode: toggleMode,
    textPrompt,
    onTextPromptChange: setTextPrompt,
    isRunning: displayActive,
    mpLoading,
    sam3IntervalMs,
    onSam3IntervalChange: setSam3IntervalMs,
    stats: {
      handCount: result?.hands?.hand_count ?? 0,
      sam3Count: result?.sam3_segments?.length ?? 0,
      hasReceivedResult,
    },
    arStreamEnabled,
    onARStreamToggle: cameraSource === "local" ? setArStreamEnabled : undefined,
    arConnectionStatus,
    arLastAckTs,
  };

  const immersiveActive = isImmersive && displayActive;

  const statsBar = (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs" style={{ color: immersiveActive ? "rgba(255,255,255,0.6)" : "#555" }}>
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
          <>
            <button
              onClick={() => setGesturesEnabled((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:scale-105"
              style={{
                backgroundColor: gesturesEnabled
                  ? "rgba(168, 85, 247, 0.2)"
                  : "rgba(255, 255, 255, 0.08)",
                color: gesturesEnabled
                  ? "var(--sf-purple)"
                  : immersiveActive ? "rgba(255,255,255,0.5)" : "#666",
                border: `1px solid ${gesturesEnabled ? "rgba(168,85,247,0.3)" : "#333"}`,
              }}
              title={gesturesEnabled ? "Disable gesture controls" : "Enable gesture controls"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {gesturesEnabled ? (
                  <>
                    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
                    <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
                    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
                    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                  </>
                ) : (
                  <>
                    <line x1="2" x2="22" y1="2" y2="22" />
                    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
                    <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
                    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
                    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                  </>
                )}
              </svg>
              {gesturesEnabled ? "Gestures" : "Gestures off"}
            </button>
            {gesturesEnabled && (
              <PinchIndicator
                leftPressed={gestureState.leftPressed}
                rightPressed={gestureState.rightPressed}
              />
            )}
          </>
        )}
        {isActive && (
          <>
            <button
              onClick={() => setMicEnabled((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:scale-105"
              style={{
                backgroundColor: voice.status === "unavailable"
                  ? "rgba(239, 68, 68, 0.2)"
                  : micEnabled && voice.isListening
                    ? "rgba(190, 242, 100, 0.2)"
                    : "rgba(255, 255, 255, 0.08)",
                color: voice.status === "unavailable"
                  ? "rgba(239, 68, 68, 0.8)"
                  : micEnabled && voice.isListening
                    ? "var(--sf-lime)"
                    : immersiveActive ? "rgba(255,255,255,0.5)" : "#666",
                border: `1px solid ${micEnabled && voice.isListening ? "rgba(190,242,100,0.3)" : "#333"}`,
              }}
              title={voice.unavailableReason ?? (micEnabled ? "Mute voice commands" : "Unmute voice commands")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {micEnabled ? (
                  <>
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </>
                ) : (
                  <>
                    <line x1="2" x2="22" y1="2" y2="22" />
                    <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                    <path d="M5 10v2a7 7 0 0 0 12 0" />
                    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </>
                )}
              </svg>
              {voice.status === "unavailable"
                ? "Unavailable"
                : micEnabled
                  ? voice.isListening ? "Listening" : "Starting..."
                  : "Muted"}
            </button>
            {voice.status === "unavailable" && voice.unavailableReason && (
              <span className="text-[10px] text-red-400/90 max-w-[180px]" title={voice.unavailableReason}>
                {voice.unavailableReason.includes("HTTPS") ? "Use HTTPS or localhost" : voice.unavailableReason}
              </span>
            )}
          </>
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
  );

  return (
    <div
      className="min-h-screen flex flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--sf-black)", color: "var(--sf-white)" }}
    >
      {/* ── Header (hidden in immersive) ── */}
      {!immersiveActive && (
        <header
          className="px-6 py-3 flex items-center gap-4"
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
              style={{ backgroundColor: displayActive ? "var(--sf-lime)" : "#444" }}
            />
            <span className="text-sm font-bold" style={{ color: displayActive ? "var(--sf-white)" : "#777" }}>
              {cameraSource === "remote" ? "Phone camera (remote)" : "Live Camera Detection"}
            </span>
            {displayActive && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-bold animate-pulse"
                style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
              >
                LIVE
              </span>
            )}
          </div>
          {displayActive && (
            <div className="ml-auto flex items-center gap-4 text-xs" style={{ color: "#555" }}>
              {mpLoading && <span className="animate-pulse" style={{ color: "var(--sf-yellow)" }}>Loading model…</span>}
              <span>{fps} fps</span>
              {sam3Result && modes.has("sam3") && (
                <span>{sam3Result.processing_ms}ms (SAM3)</span>
              )}
              <button
                onClick={() => setIsImmersive(true)}
                className="ml-2 px-3 py-1.5 rounded-lg font-bold transition-all hover:opacity-80"
                style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "var(--sf-white)", border: "1px solid #333" }}
                title="Immersive mode (F)"
              >
                <span className="flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </svg>
                  Immersive
                </span>
              </button>
            </div>
          )}
        </header>
      )}

      <div className={immersiveActive ? "" : "flex flex-1 overflow-hidden"}>
        {/* ── Sidebar (hidden in immersive) ── */}
        {!immersiveActive && <DetectorSidebar {...sidebarProps} />}

        <main className={immersiveActive ? "" : "flex-1 flex flex-col items-center justify-center p-6 overflow-hidden"}>
          {!displayActive ? (
            <div className="text-center max-w-sm mx-auto mt-32">
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
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={handleStart}
                  className="px-8 py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-80"
                  style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
                >
                  Enable Camera
                </button>
                <button
                  onClick={handleUsePhoneAsCamera}
                  className="px-8 py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-80 border border-solid"
                  style={{
                    backgroundColor: "transparent",
                    color: "var(--sf-orange)",
                    borderColor: "var(--sf-orange)",
                  }}
                >
                  Use phone as camera
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Video + Canvas (single instance, CSS toggles layout) ── */}
              <div
                className={
                  immersiveActive
                    ? "fixed inset-0 z-10 bg-black"
                    : "w-full max-w-6xl"
                }
              >
                <div
                  className={
                    immersiveActive
                      ? "relative w-full h-full"
                      : "relative rounded-2xl overflow-hidden bg-black aspect-video shadow-2xl shadow-black/50"
                  }
                  onClick={isCameraOnlyMode && cameraSource === "local" ? handleTapToFocus : undefined}
                  style={
                    isCameraOnlyMode && cameraSource === "local"
                      ? { cursor: "pointer" }
                      : undefined
                  }
                >
                  {cameraSource === "remote" ? (
                    <canvas
                      ref={remoteCanvasRef}
                      width={1920}
                      height={1080}
                      className="w-full h-full object-contain bg-black"
                      style={{ display: "block" }}
                    />
                  ) : (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  )}
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                  {focusReticle && (
                    <div
                      className="absolute w-10 h-10 border-2 border-white rounded-full pointer-events-none animate-pulse"
                      style={{
                        left: focusReticle.left - 20,
                        top: focusReticle.top - 20,
                        boxShadow: "0 0 0 2px rgba(0,0,0,0.5)",
                      }}
                      aria-hidden
                    />
                  )}

                  {/* Normal-mode badges (immersive has its own floating badges) */}
                  {!immersiveActive && (
                    <>
                      <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 rounded-full px-2.5 py-1 text-xs text-white">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        LIVE
                      </div>
                      {modeBadges.length > 0 && (
                        <div className="absolute top-3 right-3 flex gap-1.5 flex-wrap justify-end">
                          {modeBadges.map((b) => (
                            <span
                              key={b.label}
                              className="text-white text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: b.color }}
                            >
                              {b.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Normal-mode footer */}
                {!immersiveActive && (
                  <div className="mt-4">
                    <div className="flex flex-col gap-2">{statsBar}</div>
                  </div>
                )}
              </div>

              {/* ── Immersive overlay UI (badges, panels, toolbar) ── */}
              {immersiveActive && (
                <ImmersiveOverlay
                  modeBadges={modeBadges}
                  panels={overlayPanels}
                  onTogglePanel={toggleOverlayPanel}
                  onExit={() => setIsImmersive(false)}
                  optionsContent={<DetectorSidebar {...sidebarProps} floating />}
                  statsContent={statsBar}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* QR modal for "Use phone as camera" */}
      {showQrModal && remoteSessionId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
        >
          <div
            className="rounded-2xl p-6 max-w-sm w-full flex flex-col items-center gap-4"
            style={{ backgroundColor: "#111", border: "1px solid #333" }}
          >
            <h3 className="font-bold text-lg" style={{ color: "var(--sf-white)" }}>
              Scan with your phone
            </h3>
            <p className="text-xs" style={{ color: "#888" }}>
              Open the camera app or a QR scanner and scan to stream your phone camera to this laptop.
            </p>
            <div className="p-3 rounded-xl bg-white">
              <QRCodeSVG
                value={
                  (() => {
                    if (typeof window === "undefined") return "";
                    const appUrl =
                      process.env.NEXT_PUBLIC_APP_URL ||
                      window.location.origin;
                    const wsHost =
                      process.env.NEXT_PUBLIC_WS_HOST ||
                      (process.env.NEXT_PUBLIC_APP_URL
                        ? `${new URL(process.env.NEXT_PUBLIC_APP_URL).hostname}:8001`
                        : `${window.location.hostname}:8001`);
                    return `${appUrl.replace(/\/$/, "")}/live?mode=camera&session=${remoteSessionId}&host=${encodeURIComponent(wsHost)}`;
                  })()
                }
                size={200}
                level="M"
              />
            </div>
            {typeof window !== "undefined" &&
              !process.env.NEXT_PUBLIC_APP_URL &&
              (window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1") && (
              <p className="text-xs" style={{ color: "var(--sf-orange)" }}>
                Set NEXT_PUBLIC_APP_URL (e.g. http://172.21.160.1:3000) and
                NEXT_PUBLIC_WS_HOST (e.g. 172.21.160.1:8001) so your phone can
                reach this machine.
              </p>
            )}
            <p className="text-xs font-medium" style={{ color: "var(--sf-lime)" }}>
              {viewerStatus === "open" && remoteFrame
                ? "Phone connected"
                : viewerStatus === "connecting"
                  ? "Waiting for phone…"
                  : viewerStatus === "error"
                    ? "Connection error"
                    : viewerStatus === "open"
                      ? "Waiting for phone…"
                      : "Waiting for phone…"}
            </p>
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ backgroundColor: "#333", color: "var(--sf-white)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
