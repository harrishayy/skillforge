"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useWebcamRecorder } from "@/hooks/useWebcamRecorder";
import { useMicStream } from "@/hooks/useMicStream";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { useMediaPipeDetect } from "@/hooks/useMediaPipeDetect";
import type { MPResult } from "@/hooks/useMediaPipeDetect";
import { useDoubleTapDetection } from "@/hooks/useDoubleTapDetection";
import { computePinchState } from "@/lib/pinch-detection";
import { renderHandLandmarks } from "@/lib/annotation-renderer";
import { uploadStepVideos, getGuidedStepPrompt } from "@/lib/api-client";
import { showErrorToast } from "@/store/toast-store";
import * as stepStorage from "@/lib/step-storage";
import { PinchIndicator } from "@/components/live-detect/PinchIndicator";
import { PipelineStatus } from "@/components/recording/PipelineStatus";
import { Spinner } from "@/components/ui/Spinner";
import { SessionToolbar, type SessionPanels } from "@/components/recording-session/SessionToolbar";
import { SessionControlBar } from "@/components/recording-session/SessionControlBar";
import { StepHistoryPanel, type CompletedStep } from "@/components/recording-session/StepHistoryPanel";
import { HelpAndChatPanel } from "@/components/recording-session/HelpAndChatPanel";
import { StepSavedToast } from "@/components/recording-session/StepSavedToast";
import { FinishConfirmation } from "@/components/recording-session/FinishConfirmation";
import { LiveSubtitleBar } from "@/components/subtitles/LiveSubtitleBar";

type SessionState = "mounting" | "recovering" | "recording" | "confirming_finish" | "uploading" | "processing";

interface RecordingConfig {
  title: string;
  description: string;
}

interface StepVideo {
  stepNumber: number;
  blob: Blob;
}

export default function RecordingSessionPage() {
  const router = useRouter();

  const [sessionState, setSessionState] = useState<SessionState>("mounting");
  const [config, setConfig] = useState<RecordingConfig | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Step tracking
  const [currentStepNumber, setCurrentStepNumber] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<CompletedStep[]>([]);
  const [stepPrompt, setStepPrompt] = useState("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const stepTranscriptsRef = useRef<string[]>([]);
  const stepVideosRef = useRef<StepVideo[]>([]);
  const stepStartTimeRef = useRef<number>(0);
  const [stepNotes, setStepNotes] = useState<Record<number, string>>({});
  const stepNotesRef = useRef<Record<number, string>>({});
  stepNotesRef.current = stepNotes;

  // Toast state
  const [savedStepToast, setSavedStepToast] = useState<number | null>(null);
  const toastKeyRef = useRef(0);

  // Panel visibility
  const [panels, setPanels] = useState<SessionPanels>({ steps: true, helpChat: true });
  const togglePanel = useCallback((panel: keyof SessionPanels) => {
    setPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  // Video + canvas refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const mpResultRef = useRef<MPResult | null>(null);

  // Hand data as state so useDoubleTapDetection re-runs on each new frame
  const [handData, setHandData] = useState<MPResult["hands"]>(null);
  const pinchState = computePinchState(handData);

  const handleSaveNote = useCallback((stepNumber: number, text: string) => {
    setStepNotes((prev) => ({ ...prev, [stepNumber]: text }));
  }, []);

  const [micEnabled, setMicEnabled] = useState(true);
  // Single mic owner — shared between the recorder and SpeechRecognition so
  // they don't open competing getUserMedia calls (audio-capture conflict on macOS).
  const { stream: micStream } = useMicStream();
  const webcamRecorder = useWebcamRecorder();
  const snapshotTranscriptRef = useRef<() => string>(() => "");

  // Reactively attach the stream to the video element whenever either becomes available
  useEffect(() => {
    const video = videoRef.current;
    if (video && webcamRecorder.stream) {
      video.srcObject = webcamRecorder.stream;
      video.play().catch(() => {});
    }
  }, [webcamRecorder.stream]);

  // ---------------------------------------------------------------------------
  // Read config from sessionStorage, or check IndexedDB for crash recovery
  // ---------------------------------------------------------------------------
  const configLoadedRef = useRef(false);

  useEffect(() => {
    if (configLoadedRef.current) return;

    const raw = sessionStorage.getItem("sf-recording-config");
    if (raw) {
      configLoadedRef.current = true;
      sessionStorage.removeItem("sf-recording-config");
      // New session — clear any stale recovery data
      stepStorage.clearSession().catch(() => {});
      try {
        const parsed: RecordingConfig = JSON.parse(raw);
        setConfig(parsed);
      } catch {
        router.replace("/record/setup");
      }
      return;
    }

    // No fresh config — check IndexedDB for a previous crashed session
    configLoadedRef.current = true;
    stepStorage.hasRecoveryData().then((has) => {
      if (has) {
        setSessionState("recovering");
      } else {
        router.replace("/record/setup");
      }
    }).catch(() => {
      router.replace("/record/setup");
    });
  }, [router]);

  const configRef = useRef(config);
  configRef.current = config;

  // ---------------------------------------------------------------------------
  // Step prompt fetching
  // ---------------------------------------------------------------------------
  const fetchStepPrompt = useCallback(
    async (stepNum: number, prevTranscripts: string[]) => {
      const desc = configRef.current?.description ?? "";
      if (!desc.trim()) {
        setStepPrompt(`Speak and demonstrate Step ${stepNum}`);
        return;
      }
      setIsLoadingPrompt(true);
      try {
        const prompt = await getGuidedStepPrompt(desc, stepNum, prevTranscripts);
        setStepPrompt(prompt);
      } catch (err) {
        showErrorToast(err);
        setStepPrompt(`Speak and demonstrate Step ${stepNum}`);
      } finally {
        setIsLoadingPrompt(false);
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Step advancement — snapshot current step video & move to next
  // ---------------------------------------------------------------------------
  const [isSnapshotting, setIsSnapshotting] = useState(false);

  const handleNextStep = useCallback(async () => {
    if (sessionState !== "recording" || isSnapshotting) return;

    const prevStepNum = currentStepNumber;
    const transcript = snapshotTranscriptRef.current();
    stepTranscriptsRef.current.push(transcript);

    setIsSnapshotting(true);
    try {
      const snapshotTime = webcamRecorder.getDurationMs();
      const blob = await webcamRecorder.snapshot();
      const durationMs = snapshotTime - stepStartTimeRef.current;
      stepVideosRef.current.push({ stepNumber: prevStepNum, blob });

      setCompletedSteps((prev) => [...prev, { stepNumber: prevStepNum, durationMs }]);
      toastKeyRef.current += 1;
      setSavedStepToast(prevStepNum);

      // Persist to IndexedDB so data survives crashes
      stepStorage.saveStep({
        stepNumber: prevStepNum,
        blob,
        transcript,
        note: stepNotesRef.current[prevStepNum] ?? "",
        durationMs,
      }).catch((e) => console.warn("[StepStorage] Failed to save step:", e));

      const nextStep = prevStepNum + 1;
      stepStartTimeRef.current = snapshotTime;
      setCurrentStepNumber(nextStep);
      fetchStepPrompt(nextStep, [...stepTranscriptsRef.current]);
    } catch (err) {
      showErrorToast(err);
    } finally {
      setIsSnapshotting(false);
    }
  }, [sessionState, isSnapshotting, webcamRecorder, currentStepNumber, fetchStepPrompt]);

  // ---------------------------------------------------------------------------
  // Finish flow: two-action confirmation
  // ---------------------------------------------------------------------------
  const handleFinishRequest = useCallback(() => {
    if (sessionState === "confirming_finish") {
      handleConfirmFinish();
      return;
    }
    if (sessionState !== "recording") return;
    setSessionState("confirming_finish");
  }, [sessionState]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancelFinish = useCallback(() => {
    setSessionState("recording");
  }, []);

  const handleConfirmFinish = useCallback(async () => {
    const transcript = snapshotTranscriptRef.current();
    stepTranscriptsRef.current.push(transcript);

    setSessionState("uploading");

    try {
      const finalBlob = await webcamRecorder.stop();
      stepVideosRef.current.push({ stepNumber: currentStepNumber, blob: finalBlob });

      // Persist final step to IndexedDB before upload attempt
      await stepStorage.saveStep({
        stepNumber: currentStepNumber,
        blob: finalBlob,
        transcript,
        note: stepNotesRef.current[currentStepNumber] ?? "",
        durationMs: 0,
      }).catch(() => {});

      const cfg = configRef.current;
      const notesArr = stepVideosRef.current.map(
        (sv) => stepNotesRef.current[sv.stepNumber] ?? ""
      );
      const result = await uploadStepVideos({
        stepVideos: stepVideosRef.current.map((sv) => sv.blob),
        title: cfg?.title ?? "Untitled",
        initialDescription: cfg?.description,
        stepTranscripts: stepTranscriptsRef.current,
        stepNotes: notesArr,
      });

      // Upload succeeded — clear IndexedDB
      await stepStorage.clearSession().catch(() => {});

      setWorkflowId(result.workflow_id);
      setSessionState("processing");
    } catch (err) {
      showErrorToast(err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setUploadError(msg);
    }
  }, [webcamRecorder, currentStepNumber]);

  const retryUpload = useCallback(async () => {
    setUploadError(null);
    try {
      let videos: Blob[];
      let transcripts: string[];
      let notes: string[];
      let title: string;
      let description: string | undefined;

      if (stepVideosRef.current.length > 0) {
        // In-memory data available (normal flow)
        videos = stepVideosRef.current.map((sv) => sv.blob);
        transcripts = stepTranscriptsRef.current;
        notes = stepVideosRef.current.map(
          (sv) => stepNotesRef.current[sv.stepNumber] ?? ""
        );
        const cfg = configRef.current;
        title = cfg?.title ?? "Untitled";
        description = cfg?.description;
      } else {
        // Recovery path — read from IndexedDB
        const [meta, savedSteps] = await Promise.all([
          stepStorage.getSessionMeta(),
          stepStorage.getAllSteps(),
        ]);
        if (!meta || savedSteps.length === 0) {
          await stepStorage.clearSession();
          router.replace("/record/setup");
          return;
        }
        videos = savedSteps.map((s) => s.blob);
        transcripts = savedSteps.map((s) => s.transcript);
        notes = savedSteps.map((s) => s.note);
        title = meta.title;
        description = meta.description;
      }

      const result = await uploadStepVideos({
        stepVideos: videos,
        title,
        initialDescription: description,
        stepTranscripts: transcripts,
        stepNotes: notes,
      });
      await stepStorage.clearSession().catch(() => {});
      setWorkflowId(result.workflow_id);
      setSessionState("processing");
    } catch (err) {
      showErrorToast(err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setUploadError(msg);
    }
  }, [router]);

  // ---------------------------------------------------------------------------
  // Recovery: upload saved steps from IndexedDB after a crash
  // ---------------------------------------------------------------------------
  const handleRecoveryUpload = useCallback(async () => {
    setSessionState("uploading");
    try {
      const [meta, savedSteps] = await Promise.all([
        stepStorage.getSessionMeta(),
        stepStorage.getAllSteps(),
      ]);
      if (!meta || savedSteps.length === 0) {
        await stepStorage.clearSession();
        router.replace("/record/setup");
        return;
      }

      const result = await uploadStepVideos({
        stepVideos: savedSteps.map((s) => s.blob),
        title: meta.title,
        initialDescription: meta.description,
        stepTranscripts: savedSteps.map((s) => s.transcript),
        stepNotes: savedSteps.map((s) => s.note),
      });

      await stepStorage.clearSession().catch(() => {});
      setWorkflowId(result.workflow_id);
      setSessionState("processing");
    } catch (err) {
      showErrorToast(err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setUploadError(msg);
    }
  }, [router]);

  const handleRecoveryDiscard = useCallback(async () => {
    await stepStorage.clearSession().catch(() => {});
    router.replace("/record/setup");
  }, [router]);

  // ---------------------------------------------------------------------------
  // Voice commands (auto-managed by `enabled` prop)
  // ---------------------------------------------------------------------------
  const voice = useVoiceCommands({
    onNextStep: handleNextStep,
    onFinish: handleFinishRequest,
    enabled: micEnabled && (sessionState === "recording" || sessionState === "confirming_finish"),
  });

  snapshotTranscriptRef.current = voice.snapshotTranscript;

  // ---------------------------------------------------------------------------
  // MediaPipe hand detection
  // ---------------------------------------------------------------------------
  useMediaPipeDetect({
    videoRef,
    handsEnabled: true,
    objectsEnabled: false,
    enabled: sessionState === "recording" || sessionState === "confirming_finish",
    onResult: (r) => {
      mpResultRef.current = r;
      setHandData(r.hands);
    },
  });

  // Double-tap gesture detection (needs state-driven hand data to re-render each frame)
  useDoubleTapDetection(handData, {
    onSkipForward: handleNextStep,
    onSkipBackward: () => {},
  });

  // ---------------------------------------------------------------------------
  // Canvas render loop (hand landmarks overlay)
  // ---------------------------------------------------------------------------
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
    if (r?.hands?.hands?.length) {
      renderHandLandmarks(ctx, r.hands.hands, canvas.width, canvas.height, t);
    }
    animFrameRef.current = requestAnimationFrame(renderLoop);
  }, []);

  useEffect(() => {
    if (sessionState === "recording" || sessionState === "confirming_finish") {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [sessionState, renderLoop]);

  // ---------------------------------------------------------------------------
  // Start recording once config is loaded
  // ---------------------------------------------------------------------------
  const hasStartedRef = useRef(false);

  useEffect(() => {
    // Wait for both config and the shared mic stream before starting.
    // micStream may take a moment if the browser shows a permission prompt.
    if (!config || !micStream || hasStartedRef.current) return;
    hasStartedRef.current = true;

    (async () => {
      // Pass the shared mic stream so the recorder doesn't open a second getUserMedia,
      // which would conflict with SpeechRecognition's internal audio capture.
      const stream = await webcamRecorder.start(micStream);
      if (!stream) {
        setStartError("Could not access camera. Check permissions and try again.");
        return;
      }

      stepTranscriptsRef.current = [];
      stepVideosRef.current = [];
      stepStartTimeRef.current = 0;
      setCurrentStepNumber(1);
      setSessionState("recording");

      // Persist session meta so recovery knows the title/description
      const cfg = configRef.current;
      if (cfg) {
        stepStorage.saveSessionMeta({
          title: cfg.title,
          description: cfg.description,
          createdAt: Date.now(),
        }).catch(() => {});
      }

      fetchStepPrompt(1, []);
    })();
  }, [config, micStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Exit (abandon recording)
  // ---------------------------------------------------------------------------
  const handleExit = useCallback(() => {
    webcamRecorder.stop().catch(() => {});
    stepStorage.clearSession().catch(() => {});
    router.push("/record/setup");
  }, [webcamRecorder, router]);

  // Keyboard shortcut: Escape to exit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (sessionState === "recording" || sessionState === "confirming_finish")) {
        handleExit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sessionState, handleExit]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const isRecordingActive = sessionState === "recording" || sessionState === "confirming_finish";

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Video + canvas always rendered so the ref is available for stream attach */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Live subtitle bar — shown while recording */}
      {isRecordingActive && (
        <LiveSubtitleBar liveTranscript={voice.liveTranscript} />
      )}

      {/* Mounting overlay */}
      {sessionState === "mounting" && (
        <div className="absolute inset-0 z-50 bg-black flex items-center justify-center">
          <div className="text-center">
            {startError ? (
              <>
                <p className="text-sm text-red-400 mb-4">{startError}</p>
                <button
                  onClick={() => router.push("/record/setup")}
                  className="text-sm font-bold px-5 py-2.5 rounded-xl"
                  style={{ backgroundColor: "var(--sf-white)", color: "var(--sf-black)" }}
                >
                  ← Back to setup
                </button>
              </>
            ) : (
              <>
                <Spinner className="w-10 h-10 mx-auto mb-4 text-white" />
                <p className="text-sm text-white/60">Starting camera...</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Recovery overlay */}
      {sessionState === "recovering" && (
        <div className="absolute inset-0 z-50 bg-black flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div
              className="w-14 h-14 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "rgba(255,196,18,0.15)" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--sf-yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M3.6 15.4 10.3 4a2 2 0 0 1 3.4 0l6.7 11.4a2 2 0 0 1-1.7 3H5.3a2 2 0 0 1-1.7-3Z" />
              </svg>
            </div>
            <h2 className="font-black text-xl text-white mb-2">Recover Previous Session?</h2>
            <p className="text-sm text-white/50 mb-6">
              We found step recordings from a previous session that wasn&apos;t uploaded. Would you like to upload them now?
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRecoveryUpload}
                className="text-sm font-bold px-6 py-2.5 rounded-xl transition-colors"
                style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
              >
                Upload Saved Steps
              </button>
              <button
                onClick={handleRecoveryDiscard}
                className="text-sm font-bold px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-colors"
              >
                Discard & Start Fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Uploading overlay */}
      {sessionState === "uploading" && (
        <div className="absolute inset-0 z-50 bg-black flex items-center justify-center">
          {uploadError ? (
            <div className="text-center max-w-md px-6">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <h2 className="font-black text-xl text-white mb-2">Upload Failed</h2>
              <p className="text-sm text-white/50 mb-6">{uploadError}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={retryUpload}
                  className="text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
                  style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
                >
                  Retry Upload
                </button>
                <button
                  onClick={() => router.push("/record/setup")}
                  className="text-sm font-bold px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-colors"
                >
                  Back to Setup
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <Spinner className="w-10 h-10 mx-auto mb-4 text-purple-400" />
              <h2 className="font-black text-xl text-white mb-2">Uploading...</h2>
              <p className="text-sm text-white/50">Sending your recording to the AI pipeline</p>
            </div>
          )}
        </div>
      )}

      {/* Processing overlay */}
      {sessionState === "processing" && workflowId && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--sf-white)" }}>
          <div className="w-full max-w-xl px-4">
            <PipelineStatus workflowId={workflowId} />
          </div>
        </div>
      )}

      {/* Workflow title */}
      {isRecordingActive && config?.title && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40">
          <span className="text-sm font-medium text-white/40 truncate max-w-xs block">
            {config.title}
          </span>
        </div>
      )}

      {/* Top bar: REC badge + step badge + pinch + mic toggle */}
      {isRecordingActive && (
        <div className="fixed top-4 left-4 z-50 flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white"
            style={{
              backgroundColor: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <span className={`w-1.5 h-1.5 rounded-full bg-red-500 ${webcamRecorder.isPaused ? "" : "animate-pulse"}`} />
            {webcamRecorder.isPaused ? "PAUSED" : "REC"}
          </div>
          <span
            className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
          >
            Step {currentStepNumber}
          </span>

          {/* Mic toggle */}
          <button
            onClick={() => setMicEnabled((v) => !v)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all hover:scale-105"
            style={{
              backgroundColor: voice.status === "unavailable"
                ? "rgba(239, 68, 68, 0.2)"
                : micEnabled
                  ? voice.isListening
                    ? "rgba(190, 242, 100, 0.25)"
                    : "rgba(245, 158, 11, 0.25)"
                  : "rgba(255, 255, 255, 0.08)",
              color: voice.status === "unavailable"
                ? "rgba(239, 68, 68, 0.8)"
                : micEnabled
                  ? voice.isListening
                    ? "var(--sf-lime)"
                    : "var(--sf-yellow)"
                  : "rgba(255,255,255,0.4)",
              backdropFilter: "blur(20px)",
              border: `1px solid ${micEnabled && voice.isListening ? "rgba(190,242,100,0.3)" : "rgba(255,255,255,0.1)"}`,
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

          {/* Pinch indicator */}
          {handData && (
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
              style={{
                backgroundColor: "rgba(0,0,0,0.4)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <PinchIndicator leftPressed={pinchState.leftPressed} rightPressed={pinchState.rightPressed} />
            </div>
          )}
        </div>
      )}

      {/* Step saved toast */}
      <StepSavedToast key={toastKeyRef.current} stepNumber={savedStepToast} />


      {/* Left panel: step history */}
      <StepHistoryPanel
        visible={panels.steps && isRecordingActive}
        completedSteps={completedSteps}
        currentStepNumber={currentStepNumber}
      />

      {/* Right panel: help & chat */}
      <HelpAndChatPanel
        visible={panels.helpChat && isRecordingActive}
        currentStepNumber={currentStepNumber}
        stepNotes={stepNotes}
        onSaveNote={handleSaveNote}
      />

      {/* Right toolbar */}
      {isRecordingActive && (
        <SessionToolbar
          panels={panels}
          onTogglePanel={togglePanel}
          onExit={handleExit}
        />
      )}

      {/* Bottom control bar (hidden when confirming finish) */}
      <AnimatePresence>
        {sessionState === "recording" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <SessionControlBar
              isPaused={webcamRecorder.isPaused}
              durationMs={webcamRecorder.durationMs}
              currentStepNumber={currentStepNumber}
              stepPrompt={stepPrompt}
              isLoadingPrompt={isLoadingPrompt}
              micEnabled={micEnabled}
              isListening={voice.isListening}
              voiceStatus={voice.status}
              voiceUnavailableReason={voice.unavailableReason}
              onNextStep={handleNextStep}
              onFinish={handleFinishRequest}
              onPause={webcamRecorder.pause}
              onResume={webcamRecorder.resume}
              onToggleMic={() => setMicEnabled((v) => !v)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Finish confirmation overlay (replaces control bar) */}
      <FinishConfirmation
        visible={sessionState === "confirming_finish"}
        onConfirm={handleConfirmFinish}
        onCancel={handleCancelFinish}
      />
    </div>
  );
}
