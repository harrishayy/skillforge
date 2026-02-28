"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { TaskMode } from "@/types";
import { ModeSelector } from "@/components/recording/ModeSelector";
import { RecordingControls } from "@/components/recording/RecordingControls";
import { PipelineStatus } from "@/components/recording/PipelineStatus";
import { useScreenRecorder } from "@/hooks/useScreenRecorder";
import { useWebcamRecorder } from "@/hooks/useWebcamRecorder";
import { useInputLogger } from "@/hooks/useInputLogger";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { uploadRecording, getGuidedStepPrompt } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useMediaPipeDetect } from "@/hooks/useMediaPipeDetect";
import type { MPResult } from "@/hooks/useMediaPipeDetect";
import { renderHandLandmarks } from "@/lib/annotation-renderer";

type PageState = "idle" | "setup" | "recording" | "uploading" | "processing";

const YOLO_COLORS = [
  "#3B82F6", "#8B5CF6", "#10B981", "#F59E0B",
  "#EF4444", "#06B6D4", "#EC4899", "#14B8A6",
];

interface StepMarker {
  step_number: number;
  start_ms: number;
  end_ms: number;
}

export default function RecordPage() {
  const [pageState, setPageState] = useState<PageState>("idle");
  const [mode, setMode] = useState<TaskMode | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Guided step state
  const [currentStepNumber, setCurrentStepNumber] = useState(1);
  const [stepPrompt, setStepPrompt] = useState("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const stepMarkersRef = useRef<StepMarker[]>([]);
  const stepTranscriptsRef = useRef<string[]>([]);

  const screenRecorder = useScreenRecorder();
  const webcamRecorder = useWebcamRecorder();
  const inputLogger = useInputLogger();

  // Callback ref: fires on every mount, so the stream is attached even after
  // AnimatePresence swaps the video element between states.
  const webcamStreamRef = useRef<MediaStream | null>(null);

  // Detection refs and state — hardware mode only
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const mpResultRef = useRef<MPResult | null>(null);
  const [detectionModes, setDetectionModes] = useState<Set<"hands" | "yolo">>(
    () => new Set(["hands", "yolo"])
  );
  const [mpStats, setMpStats] = useState({ handCount: 0, objectCount: 0 });

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && webcamStreamRef.current) {
      node.srcObject = webcamStreamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  const activeRecorder = mode === "software" ? screenRecorder : webcamRecorder;

  // Ref so handlers can call snapshotTranscript without circular dependency
  const snapshotTranscriptRef = useRef<() => string>(() => "");

  const fetchStepPrompt = useCallback(
    async (stepNum: number, prevTranscripts: string[]) => {
      if (!description.trim()) {
        setStepPrompt(`Speak and demonstrate Step ${stepNum}`);
        return;
      }
      setIsLoadingPrompt(true);
      try {
        const prompt = await getGuidedStepPrompt(description, stepNum, prevTranscripts);
        setStepPrompt(prompt);
      } catch {
        setStepPrompt(`Speak and demonstrate Step ${stepNum}`);
      } finally {
        setIsLoadingPrompt(false);
      }
    },
    [description]
  );

  const handleNextStep = useCallback(() => {
    const nowMs = activeRecorder.durationMs;
    const prevStep = currentStepNumber;

    // Snapshot transcript for the step that just ended
    const transcript = snapshotTranscriptRef.current();
    stepTranscriptsRef.current.push(transcript);

    // Close the current step marker
    const existing = stepMarkersRef.current;
    const prevMarker = existing[existing.length - 1];
    if (prevMarker && prevMarker.end_ms === 0) {
      prevMarker.end_ms = nowMs;
    }

    // Open new step marker
    const nextStep = prevStep + 1;
    stepMarkersRef.current.push({ step_number: nextStep, start_ms: nowMs, end_ms: 0 });
    setCurrentStepNumber(nextStep);

    // Fetch prompt for next step async
    fetchStepPrompt(nextStep, [...stepTranscriptsRef.current]);
  }, [activeRecorder, currentStepNumber, fetchStepPrompt]);

  const handleFinish = useCallback(() => {
    // Snapshot final transcript
    const transcript = snapshotTranscriptRef.current();
    stepTranscriptsRef.current.push(transcript);

    // Close final step marker
    const existing = stepMarkersRef.current;
    const last = existing[existing.length - 1];
    if (last && last.end_ms === 0) {
      last.end_ms = activeRecorder.durationMs;
    }

    handleStop();
  }, [activeRecorder]); // eslint-disable-line react-hooks/exhaustive-deps

  const voice = useVoiceCommands({
    onNextStep: handleNextStep,
    onFinish: handleFinish,
    enabled: pageState === "recording",
  });

  // Keep snapshotTranscriptRef in sync with the voice hook instance
  snapshotTranscriptRef.current = voice.snapshotTranscript;

  // ── MediaPipe detection — hardware mode only, active during recording ──────
  const { mpLoading, mpError } = useMediaPipeDetect({
    videoRef,
    handsEnabled: detectionModes.has("hands"),
    objectsEnabled: detectionModes.has("yolo"),
    enabled: mode === "hardware" && pageState === "recording",
    onResult: (r) => {
      mpResultRef.current = r;
      setMpStats({ handCount: r.hands?.hand_count ?? 0, objectCount: r.mp_detections.length });
    },
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
    const r = mpResultRef.current;
    if (r) {
      if (detectionModes.has("hands") && r.hands?.hands?.length) {
        renderHandLandmarks(ctx, r.hands.hands, canvas.width, canvas.height, t);
      }
      if (detectionModes.has("yolo")) {
        r.mp_detections.forEach((det, i) => {
          const color = YOLO_COLORS[i % YOLO_COLORS.length];
          const x = (det.bbox_x / 100) * canvas.width;
          const y = (det.bbox_y / 100) * canvas.height;
          const bw = (det.bbox_width / 100) * canvas.width;
          const bh = (det.bbox_height / 100) * canvas.height;
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
          ctx.strokeRect(x, y, bw, bh);
          const label = `${det.class} ${Math.round(det.confidence * 100)}%`;
          ctx.font = "bold 12px system-ui";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = color; ctx.globalAlpha = 0.9;
          ctx.fillRect(x, y - 18, tw + 8, 18);
          ctx.fillStyle = "#fff"; ctx.globalAlpha = 1;
          ctx.fillText(label, x + 4, y - 4);
          ctx.restore();
        });
      }
    }
    animFrameRef.current = requestAnimationFrame(renderLoop);
  }, [detectionModes]);

  useEffect(() => {
    if (mode === "hardware" && pageState === "recording") {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mode, pageState, renderLoop]);

  const handleModeSelect = (selectedMode: TaskMode) => {
    setMode(selectedMode);
    setPageState("setup");
  };

  const handleStartRecording = async () => {
    if (!mode || !title.trim()) return;
    if (mode === "software") {
      await screenRecorder.start();
      inputLogger.startLogging();
    } else {
      // Capture stream synchronously from start() — webcamRecorder.stream won't
      // update until the next render, so we store it in a ref for the callback ref.
      const stream = await webcamRecorder.start();
      webcamStreamRef.current = stream;
    }

    if (activeRecorder.error) return;

    // Initialise first step marker
    stepMarkersRef.current = [{ step_number: 1, start_ms: 0, end_ms: 0 }];
    stepTranscriptsRef.current = [];
    setCurrentStepNumber(1);
    setPageState("recording");

    // Start voice commands and fetch first step prompt
    voice.start();
    fetchStepPrompt(1, []);
  };

  const handleStop = async () => {
    voice.stop();
    activeRecorder.stop();
    const inputEvents = mode === "software" ? inputLogger.stopLogging() : [];

    // Wait for blob
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (activeRecorder.videoBlob) {
          clearInterval(check);
          resolve();
        }
      }, 200);
    });

    if (!activeRecorder.videoBlob) return;
    setPageState("uploading");

    const formData = new FormData();
    formData.append("video", activeRecorder.videoBlob, "recording.webm");
    formData.append("mode", mode!);
    formData.append("title", title);
    formData.append("initial_description", description);
    formData.append("step_markers", JSON.stringify(stepMarkersRef.current));
    formData.append("step_transcripts", JSON.stringify(stepTranscriptsRef.current));
    if (inputEvents.length) {
      formData.append("input_events", JSON.stringify(inputEvents));
    }

    try {
      const result = await uploadRecording(formData);
      setWorkflowId(result.workflow_id);
      setPageState("processing");
    } catch (err) {
      console.error("Upload failed:", err);
      setPageState("idle");
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--sf-white)" }}>
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <AnimatePresence mode="wait">
          {pageState === "idle" && (
            <motion.div
              key="mode-select"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-2xl"
            >
              <ModeSelector onSelect={handleModeSelect} />
            </motion.div>
          )}

          {pageState === "setup" && mode && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-lg"
            >
              <h2
                className="font-black mb-6"
                style={{ fontSize: "1.75rem", letterSpacing: "-0.04em", color: "var(--sf-black)" }}
              >
                {mode === "software" ? "💻 Screen Recording" : "🔧 Webcam Recording"}
              </h2>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-bold mb-1" style={{ color: "var(--sf-black)" }}>Workflow Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. How to create a GitHub repository"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--sf-white)", border: "1px solid var(--sf-black)", color: "var(--sf-black)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1" style={{ color: "var(--sf-black)" }}>
                    Brief description{" "}
                    <span style={{ color: "var(--sf-gray)", fontWeight: 400 }}>(helps the AI guide you step by step)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="e.g. Demonstrate how to fork a repo, clone it locally, and push a change"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none resize-none"
                    style={{ backgroundColor: "var(--sf-white)", border: "1px solid var(--sf-black)", color: "var(--sf-black)" }}
                  />
                </div>
              </div>

              {mode === "hardware" && (
                <>
                  <div className="relative mb-3">
                    <video
                      ref={attachVideo}
                      autoPlay
                      muted
                      playsInline
                      className="w-full aspect-video bg-zinc-900 rounded-lg object-cover"
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full pointer-events-none"
                    />
                  </div>
                  <div className="flex items-center gap-4 px-1 mb-4">
                    <label className="flex items-center gap-1.5 text-sm font-medium cursor-pointer select-none" style={{ color: "var(--sf-black)" }}>
                      <input
                        type="checkbox"
                        checked={detectionModes.has("hands")}
                        onChange={() => setDetectionModes(prev => { const n = new Set(prev); n.has("hands") ? n.delete("hands") : n.add("hands"); return n; })}
                        className="w-3.5 h-3.5 accent-yellow-400"
                      />
                      Hand Tracking
                    </label>
                    <label className="flex items-center gap-1.5 text-sm font-medium cursor-pointer select-none" style={{ color: "var(--sf-black)" }}>
                      <input
                        type="checkbox"
                        checked={detectionModes.has("yolo")}
                        onChange={() => setDetectionModes(prev => { const n = new Set(prev); n.has("yolo") ? n.delete("yolo") : n.add("yolo"); return n; })}
                        className="w-3.5 h-3.5 accent-purple-400"
                      />
                      YOLO Objects
                    </label>
                    <span style={{ color: "#ccc" }}>|</span>
                    <span className="text-xs" style={{ color: "var(--sf-gray)" }}>Starts when recording begins</span>
                  </div>
                </>
              )}

              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => { setMode(null); setPageState("idle"); }}>
                  ← Back
                </Button>
                <Button
                  onClick={handleStartRecording}
                  disabled={!title.trim()}
                  className="flex-1"
                >
                  Start Guided Recording
                </Button>
              </div>

              {activeRecorder.error && (
                <p className="mt-3 text-sm font-medium" style={{ color: "var(--sf-orange)" }}>{activeRecorder.error}</p>
              )}
            </motion.div>
          )}

          {pageState === "recording" && (
            <motion.div
              key="recording"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-2xl"
            >
              {mode === "software" && (
                <div
                  className="aspect-video rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: "var(--sf-black)", border: "1px solid #333" }}
                >
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full border-4 border-red-500 border-dashed animate-spin mx-auto mb-4 opacity-60" />
                    <p className="text-sm" style={{ color: "#888" }}>Recording your screen...</p>
                    <p className="text-xs mt-1" style={{ color: "#555" }}>Step {currentStepNumber} in progress</p>
                  </div>
                </div>
              )}
              {mode === "hardware" && (
                <>
                  <div className="relative">
                    <video
                      ref={attachVideo}
                      autoPlay
                      muted
                      playsInline
                      className="w-full aspect-video bg-zinc-900 rounded-xl object-cover"
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full pointer-events-none"
                    />
                  </div>
                  <div className="flex items-center gap-4 px-1 mt-3">
                    <label className="flex items-center gap-1.5 text-sm font-medium cursor-pointer select-none" style={{ color: "#ccc" }}>
                      <input
                        type="checkbox"
                        checked={detectionModes.has("hands")}
                        onChange={() => setDetectionModes(prev => { const n = new Set(prev); n.has("hands") ? n.delete("hands") : n.add("hands"); return n; })}
                        className="w-3.5 h-3.5 accent-yellow-400"
                      />
                      Hand Tracking
                    </label>
                    <label className="flex items-center gap-1.5 text-sm font-medium cursor-pointer select-none" style={{ color: "#ccc" }}>
                      <input
                        type="checkbox"
                        checked={detectionModes.has("yolo")}
                        onChange={() => setDetectionModes(prev => { const n = new Set(prev); n.has("yolo") ? n.delete("yolo") : n.add("yolo"); return n; })}
                        className="w-3.5 h-3.5 accent-purple-400"
                      />
                      YOLO Objects
                    </label>
                    <span style={{ color: "#444" }}>|</span>
                    {mpLoading
                      ? <span className="text-xs animate-pulse" style={{ color: "var(--sf-yellow)" }}>Loading model…</span>
                      : mpError
                        ? <span className="text-xs" style={{ color: "var(--sf-orange)" }}>Detection unavailable</span>
                        : <span className="text-xs" style={{ color: "#888" }}>{mpStats.handCount} hands · {mpStats.objectCount} objects</span>
                    }
                  </div>
                </>
              )}
            </motion.div>
          )}

          {pageState === "uploading" && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center"
            >
              <span style={{ color: "var(--sf-purple)" }}><Spinner className="w-10 h-10 mx-auto mb-4" /></span>
              <h2 className="font-black mb-2" style={{ fontSize: "1.5rem", letterSpacing: "-0.03em", color: "var(--sf-black)" }}>Uploading...</h2>
              <p className="text-sm" style={{ color: "var(--sf-gray)" }}>Sending your recording to the AI pipeline</p>
            </motion.div>
          )}

          {pageState === "processing" && workflowId && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-xl"
            >
              <PipelineStatus workflowId={workflowId} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <RecordingControls
        isRecording={pageState === "recording"}
        isPaused={activeRecorder.isPaused}
        durationMs={activeRecorder.durationMs}
        currentStepNumber={currentStepNumber}
        stepPrompt={stepPrompt}
        isLoadingPrompt={isLoadingPrompt}
        onNextStep={handleNextStep}
        onFinish={handleFinish}
        onPause={activeRecorder.pause}
        onResume={activeRecorder.resume}
      />
    </div>
  );
}
