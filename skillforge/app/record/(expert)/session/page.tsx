"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useWebcamRecorder } from "@/hooks/useWebcamRecorder";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { useMediaPipeDetect } from "@/hooks/useMediaPipeDetect";
import type { MPResult } from "@/hooks/useMediaPipeDetect";
import { useDoubleTapDetection } from "@/hooks/useDoubleTapDetection";
import { computePinchState } from "@/lib/pinch-detection";
import { renderHandLandmarks } from "@/lib/annotation-renderer";
import { uploadStepVideos, getGuidedStepPrompt } from "@/lib/api-client";
import { showErrorToast } from "@/store/toast-store";
import type { PipelineLogEvent, PipelineStage } from "@/types";
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

type SessionState = "mounting" | "recovering" | "apparatus_showcase" | "recording" | "confirming_finish" | "uploading" | "processing";

interface RecordingConfig {
  title: string;
  description: string;
}

interface StepVideo {
  stepNumber: number;
  blob: Blob;
  durationMs: number;
}

export default function RecordingSessionPage() {
  const router = useRouter();

  const [sessionState, setSessionState] = useState<SessionState>("mounting");
  const [config, setConfig] = useState<RecordingConfig | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadLogs, setUploadLogs] = useState<PipelineLogEvent[]>([]);

  const pushUploadLog = useCallback((stage: PipelineStage, message: string) => {
    setUploadLogs((prev) => [
      ...prev,
      { type: "pipeline_log", stage, message, progress: 0, timestamp: Date.now() },
    ]);
  }, []);

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
  const [editingStepNumber, setEditingStepNumber] = useState<number | null>(null);

  // Apparatus showcase state
  const [apparatusPhase, setApparatusPhase] = useState<"overview" | "individual">("overview");
  const [apparatusObjectCount, setApparatusObjectCount] = useState(0);
  const apparatusBlobRef = useRef<Blob | null>(null);

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

  const handleEditStep = useCallback((stepNumber: number) => {
    setEditingStepNumber(stepNumber);
  }, []);

  const [micEnabled, setMicEnabled] = useState(true);
  const [gesturesEnabled, setGesturesEnabled] = useState(true);
  const webcamRecorder = useWebcamRecorder();
  const snapshotTranscriptRef = useRef<() => string>(() => "");

  // Reactively attach the stream to the video element whenever either becomes available
  useEffect(() => {
    const video = videoRef.current;
    if (video && webcamRecorder.stream) {
      video.srcObject = webcamRecorder.stream;
      video.play().catch((err: unknown) => console.warn("[Session] Video autoplay blocked by browser policy:", err));
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
      stepStorage.clearSession().catch((err: unknown) => console.warn("[Session] Failed to clear previous session from IndexedDB:", err));
      try {
        const parsed: RecordingConfig = JSON.parse(raw);
        setConfig(parsed);
      } catch (err) {
        console.warn("[Session] Failed to parse recording config JSON — redirecting to setup:", err);
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
    }).catch((err: unknown) => {
      console.warn("[Session] Recovery data check failed — redirecting to setup:", err);
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
      stepVideosRef.current.push({ stepNumber: prevStepNum, blob, durationMs });

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
      }).catch((e) => {
        console.warn("[StepStorage] Failed to save step:", e);
        showErrorToast("Failed to save step to local storage. If the browser's storage is full, try clearing site data.");
      });

      const nextStep = prevStepNum + 1;
      stepStartTimeRef.current = snapshotTime;
      setCurrentStepNumber(nextStep);
      setEditingStepNumber(null);
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

    console.log("[FinishRecording] Confirmed — transitioning to uploading state");
    setUploadLogs([]);
    setUploadError(null);
    setSessionState("uploading");

    try {
      pushUploadLog("upload", "Stopping recorder and packaging video...");
      console.log("[FinishRecording] Stopping webcam recorder...");
      const finalSnapshotTime = webcamRecorder.getDurationMs();
      const finalBlob = await webcamRecorder.stop();
      const finalDurationMs = finalSnapshotTime - stepStartTimeRef.current;
      console.log(`[FinishRecording] Final blob: ${(finalBlob.size / 1024).toFixed(0)} KB`);
      stepVideosRef.current.push({ stepNumber: currentStepNumber, blob: finalBlob, durationMs: finalDurationMs });

      pushUploadLog("upload", "Saving step locally as backup...");
      console.log("[FinishRecording] Persisting final step to IndexedDB...");
      await stepStorage.saveStep({
        stepNumber: currentStepNumber,
        blob: finalBlob,
        transcript,
        note: stepNotesRef.current[currentStepNumber] ?? "",
        durationMs: 0,
      }).catch((e) => {
        console.warn("[FinishRecording] IndexedDB save failed:", e);
        showErrorToast("Failed to persist recording backup. Upload may not be recoverable if it fails.");
      });

      const cfg = configRef.current;
      const notesArr = stepVideosRef.current.map(
        (sv) => stepNotesRef.current[sv.stepNumber] ?? ""
      );
      const totalMB = stepVideosRef.current.reduce((s, v) => s + v.blob.size, 0) / 1024 / 1024;
      pushUploadLog(
        "upload",
        `Uploading ${stepVideosRef.current.length} step video(s) (${totalMB.toFixed(1)} MB)...`
      );
      console.log(`[FinishRecording] Uploading ${stepVideosRef.current.length} step video(s)...`);
      const result = await uploadStepVideos({
        stepVideos: stepVideosRef.current.map((sv) => sv.blob),
        title: cfg?.title ?? "Untitled",
        initialDescription: cfg?.description,
        stepTranscripts: stepTranscriptsRef.current,
        stepNotes: notesArr,
        stepDurations: stepVideosRef.current.map((sv) => sv.durationMs),
        apparatusVideo: apparatusBlobRef.current ?? undefined,
      });

      pushUploadLog("upload", "Upload complete — starting AI pipeline...");
      console.log("[FinishRecording] Upload succeeded, workflow_id:", result.workflow_id);
      await stepStorage.clearSession().catch((err: unknown) => console.warn("[FinishRecording] Post-upload IndexedDB cleanup failed:", err));

      setWorkflowId(result.workflow_id);
      setSessionState("processing");
    } catch (err) {
      console.error("[FinishRecording] Failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      pushUploadLog("error", msg);
      showErrorToast(err);
      setUploadError(msg);
    }
  }, [webcamRecorder, currentStepNumber, pushUploadLog]);

  const retryUpload = useCallback(async () => {
    console.log("[RetryUpload] Retrying upload...");
    setUploadError(null);
    setUploadLogs([]);
    try {
      let videos: Blob[];
      let transcripts: string[];
      let notes: string[];
      let title: string;
      let description: string | undefined;

      let durations: number[] | undefined;

      let apparatusBlob: Blob | undefined;

      if (stepVideosRef.current.length > 0) {
        console.log("[RetryUpload] Using in-memory data");
        pushUploadLog("upload", "Retrying with in-memory data...");
        videos = stepVideosRef.current.map((sv) => sv.blob);
        transcripts = stepTranscriptsRef.current;
        notes = stepVideosRef.current.map(
          (sv) => stepNotesRef.current[sv.stepNumber] ?? ""
        );
        durations = stepVideosRef.current.map((sv) => sv.durationMs);
        apparatusBlob = apparatusBlobRef.current ?? undefined;
        const cfg = configRef.current;
        title = cfg?.title ?? "Untitled";
        description = cfg?.description;
      } else {
        console.log("[RetryUpload] Reading from IndexedDB (recovery path)");
        pushUploadLog("upload", "Recovering saved steps from local storage...");
        const [meta, savedSteps] = await Promise.all([
          stepStorage.getSessionMeta(),
          stepStorage.getAllSteps(),
        ]);
        if (!meta || savedSteps.length === 0) {
          console.warn("[RetryUpload] No recovery data found, redirecting to setup");
          showErrorToast("No saved recording data found. Starting fresh.");
          await stepStorage.clearSession();
          router.replace("/record/setup");
          return;
        }
        console.log(`[RetryUpload] Recovered ${savedSteps.length} step(s) from IndexedDB`);
        pushUploadLog("upload", `Recovered ${savedSteps.length} step(s)`);
        videos = savedSteps.map((s) => s.blob);
        transcripts = savedSteps.map((s) => s.transcript);
        notes = savedSteps.map((s) => s.note);
        durations = savedSteps.map((s) => s.durationMs);
        title = meta.title;
        description = meta.description;
      }

      const totalMB = videos.reduce((s, b) => s + b.size, 0) / 1024 / 1024;
      pushUploadLog("upload", `Uploading ${videos.length} step video(s) (${totalMB.toFixed(1)} MB)...`);
      console.log(`[RetryUpload] Uploading ${videos.length} step video(s)...`);
      const result = await uploadStepVideos({
        stepVideos: videos,
        title,
        initialDescription: description,
        stepTranscripts: transcripts,
        stepNotes: notes,
        stepDurations: durations,
        apparatusVideo: apparatusBlob,
      });
      pushUploadLog("upload", "Upload complete — starting AI pipeline...");
      console.log("[RetryUpload] Success, workflow_id:", result.workflow_id);
      await stepStorage.clearSession().catch((err: unknown) => console.warn("[RetryUpload] Post-upload IndexedDB cleanup failed:", err));
      setWorkflowId(result.workflow_id);
      setSessionState("processing");
    } catch (err) {
      console.error("[RetryUpload] Failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      pushUploadLog("error", msg);
      showErrorToast(err);
      setUploadError(msg);
    }
  }, [router, pushUploadLog]);

  // ---------------------------------------------------------------------------
  // Recovery: upload saved steps from IndexedDB after a crash
  // ---------------------------------------------------------------------------
  const handleRecoveryUpload = useCallback(async () => {
    console.log("[RecoveryUpload] Starting recovery upload from IndexedDB...");
    setUploadLogs([]);
    setUploadError(null);
    setSessionState("uploading");
    try {
      pushUploadLog("upload", "Recovering saved steps from local storage...");
      const [meta, savedSteps] = await Promise.all([
        stepStorage.getSessionMeta(),
        stepStorage.getAllSteps(),
      ]);
      if (!meta || savedSteps.length === 0) {
        console.warn("[RecoveryUpload] No recovery data found, redirecting to setup");
        showErrorToast("No saved recording data found. Starting fresh.");
        await stepStorage.clearSession();
        router.replace("/record/setup");
        return;
      }

      const totalMB = savedSteps.reduce((s, v) => s + v.blob.size, 0) / 1024 / 1024;
      pushUploadLog("upload", `Recovered ${savedSteps.length} step(s) — uploading (${totalMB.toFixed(1)} MB)...`);
      console.log(`[RecoveryUpload] Recovered ${savedSteps.length} step(s), uploading...`);
      const result = await uploadStepVideos({
        stepVideos: savedSteps.map((s) => s.blob),
        title: meta.title,
        initialDescription: meta.description,
        stepTranscripts: savedSteps.map((s) => s.transcript),
        stepNotes: savedSteps.map((s) => s.note),
        stepDurations: savedSteps.map((s) => s.durationMs),
      });

      pushUploadLog("upload", "Upload complete — starting AI pipeline...");
      console.log("[RecoveryUpload] Success, workflow_id:", result.workflow_id);
      await stepStorage.clearSession().catch((err: unknown) => console.warn("[RecoveryUpload] Post-upload IndexedDB cleanup failed:", err));
      setWorkflowId(result.workflow_id);
      setSessionState("processing");
    } catch (err) {
      console.error("[RecoveryUpload] Failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      pushUploadLog("error", msg);
      showErrorToast(err);
      setUploadError(msg);
    }
  }, [router, pushUploadLog]);

  const handleRecoveryDiscard = useCallback(async () => {
    await stepStorage.clearSession().catch((err: unknown) => console.warn("[Session] Failed to clear session on discard:", err));
    router.replace("/record/setup");
  }, [router]);

  // ---------------------------------------------------------------------------
  // Exit (abandon recording)
  // ---------------------------------------------------------------------------
  const handleExit = useCallback(() => {
    webcamRecorder.stop().catch((err: unknown) => console.warn("[Session] Webcam recorder stop failed during exit:", err));
    stepStorage.clearSession().catch((err: unknown) => console.warn("[Session] IndexedDB cleanup failed during exit:", err));
    router.push("/record/setup");
  }, [webcamRecorder, router]);

  // ---------------------------------------------------------------------------
  // Apparatus showcase handlers (defined before voice commands so wrappers work)
  // ---------------------------------------------------------------------------
  const handleApparatusOverviewDone = useCallback(() => {
    setApparatusPhase("individual");
    setApparatusObjectCount(1);
  }, []);

  const handleApparatusNextObject = useCallback(() => {
    setApparatusObjectCount((c) => c + 1);
  }, []);

  const handleApparatusDone = useCallback(async () => {
    try {
      const blob = await webcamRecorder.snapshot();
      apparatusBlobRef.current = blob;
      console.log(`[Session] Apparatus showcase captured: ${(blob.size / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.warn("[Session] Failed to snapshot apparatus video:", err);
    }

    stepStartTimeRef.current = webcamRecorder.getDurationMs();
    setSessionState("recording");
    fetchStepPrompt(1, []);
  }, [webcamRecorder, fetchStepPrompt]);

  const handleApparatusSkip = useCallback(() => {
    apparatusBlobRef.current = null;
    stepStartTimeRef.current = webcamRecorder.getDurationMs();
    setSessionState("recording");
    fetchStepPrompt(1, []);
  }, [webcamRecorder, fetchStepPrompt]);

  // ---------------------------------------------------------------------------
  // Voice-aware wrappers: route "next" / "finish" based on current phase
  // ---------------------------------------------------------------------------
  const apparatusPhaseRef = useRef(apparatusPhase);
  apparatusPhaseRef.current = apparatusPhase;

  const voiceNext = useCallback(() => {
    if (sessionState === "apparatus_showcase") {
      if (apparatusPhaseRef.current === "overview") {
        handleApparatusOverviewDone();
      } else {
        handleApparatusNextObject();
      }
    } else {
      handleNextStep();
    }
  }, [sessionState, handleApparatusOverviewDone, handleApparatusNextObject, handleNextStep]);

  const voiceFinish = useCallback(() => {
    if (sessionState === "apparatus_showcase") {
      handleApparatusDone();
    } else {
      handleFinishRequest();
    }
  }, [sessionState, handleApparatusDone, handleFinishRequest]);

  // ---------------------------------------------------------------------------
  // Voice commands (auto-managed by `enabled` prop)
  // ---------------------------------------------------------------------------
  const voice = useVoiceCommands({
    onNextStep: voiceNext,
    onFinish: voiceFinish,
    enabled: micEnabled && (sessionState === "recording" || sessionState === "confirming_finish" || sessionState === "apparatus_showcase"),
    transcriptionSource: "browser",
    audioStream: webcamRecorder.audioStream,
  });

  snapshotTranscriptRef.current = voice.snapshotTranscript;

  // ---------------------------------------------------------------------------
  // MediaPipe hand detection
  // ---------------------------------------------------------------------------
  useMediaPipeDetect({
    videoRef,
    handsEnabled: true,
    objectsEnabled: false,
    enabled: sessionState === "recording" || sessionState === "confirming_finish" || sessionState === "apparatus_showcase",
    onResult: (r) => {
      mpResultRef.current = r;
      setHandData(r.hands);
    },
  });

  useDoubleTapDetection(gesturesEnabled ? handData : null, {
    onSkipForward: voiceNext,
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
    if (sessionState === "recording" || sessionState === "confirming_finish" || sessionState === "apparatus_showcase") {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [sessionState, renderLoop]);

  // ---------------------------------------------------------------------------
  // Start recording once config is loaded
  // ---------------------------------------------------------------------------
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!config || hasStartedRef.current) return;
    hasStartedRef.current = true;

    (async () => {
      // Single getUserMedia call for both camera + mic (one permission prompt).
      const stream = await webcamRecorder.start();
      if (!stream) {
        setStartError("Could not access camera. Check permissions and try again.");
        return;
      }

      stepTranscriptsRef.current = [];
      stepVideosRef.current = [];
      stepStartTimeRef.current = 0;
      setCurrentStepNumber(1);
      setApparatusPhase("overview");
      setApparatusObjectCount(0);
      setSessionState("apparatus_showcase");

      // Persist session meta so recovery knows the title/description
      const cfg = configRef.current;
      if (cfg) {
        stepStorage.saveSessionMeta({
          title: cfg.title,
          description: cfg.description,
          createdAt: Date.now(),
        }).catch((err: unknown) => console.warn("[Session] Failed to save session metadata to IndexedDB:", err));
      }
    })();
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apparatus-specific guidance prompts
  useEffect(() => {
    if (sessionState !== "apparatus_showcase") return;
    if (apparatusPhase === "overview") {
      setStepPrompt(
        "Place all tools and parts needed for this workflow in the frame. Show everything together so the system can build an inventory."
      );
    } else {
      setStepPrompt(
        "Show this object individually from 2\u20133 angles, rotating slowly so the system can capture it from each side."
      );
    }
  }, [sessionState, apparatusPhase]);

  // Keyboard shortcut: Escape to exit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (sessionState === "recording" || sessionState === "confirming_finish" || sessionState === "apparatus_showcase")) {
        handleExit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sessionState, handleExit]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const isRecordingActive = sessionState === "recording" || sessionState === "confirming_finish" || sessionState === "apparatus_showcase";

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
                <p className="text-sm text-white/60">Starting camera &amp; microphone...</p>
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

      {/* (apparatus overlay removed — SessionControlBar handles it now) */}

      {/* Unified uploading + processing overlay */}
      {(sessionState === "uploading" || sessionState === "processing") && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--sf-white)" }}>
          <div className="w-full max-w-xl px-4">
            <PipelineStatus
              workflowId={workflowId}
              initialLogs={uploadLogs}
              uploadError={uploadError}
              onRetry={retryUpload}
              onBack={() => router.push("/record/setup")}
            />
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
            style={{
              backgroundColor: sessionState === "apparatus_showcase" ? "var(--sf-yellow)" : "var(--sf-purple)",
              color: "var(--sf-black)",
            }}
          >
            {sessionState === "apparatus_showcase"
              ? apparatusPhase === "overview"
                ? "Apparatus — Overview"
                : `Apparatus — Object ${apparatusObjectCount}`
              : `Step ${currentStepNumber}`}
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

          {/* Voice fallback / error badge */}
          {voice.fallbackActive && (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "rgba(245,158,11,0.25)", color: "var(--sf-yellow)" }}
            >
              Browser fallback
            </span>
          )}
          {voice.status === "unavailable" && voice.unavailableReason && (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full max-w-[200px] truncate"
              style={{ backgroundColor: "rgba(239,68,68,0.2)", color: "rgba(239,68,68,0.8)" }}
            >
              {voice.unavailableReason}
            </span>
          )}

          {/* Gesture toggle */}
          <button
            onClick={() => setGesturesEnabled((v) => !v)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all hover:scale-105"
            style={{
              backgroundColor: gesturesEnabled
                ? "rgba(168, 85, 247, 0.25)"
                : "rgba(255, 255, 255, 0.08)",
              color: gesturesEnabled ? "var(--sf-purple)" : "rgba(255,255,255,0.4)",
              backdropFilter: "blur(20px)",
              border: `1px solid ${gesturesEnabled ? "rgba(168,85,247,0.3)" : "rgba(255,255,255,0.1)"}`,
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

          {/* Pinch indicator */}
          {gesturesEnabled && handData && (
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
        editingStepNumber={editingStepNumber}
        onStepClick={handleEditStep}
        apparatus={sessionState === "apparatus_showcase" ? {
          active: true,
          phase: apparatusPhase,
          objectCount: apparatusObjectCount,
        } : undefined}
      />

      {/* Right panel: help & chat */}
      <HelpAndChatPanel
        visible={panels.helpChat && isRecordingActive}
        currentStepNumber={currentStepNumber}
        editingStepNumber={editingStepNumber}
        stepNotes={stepNotes}
        onSaveNote={handleSaveNote}
        onEditStep={handleEditStep}
        apparatusActive={sessionState === "apparatus_showcase"}
      />

      {/* Right toolbar */}
      {isRecordingActive && (
        <SessionToolbar
          panels={panels}
          onTogglePanel={togglePanel}
          onExit={handleExit}
        />
      )}

      {/* Bottom control bar */}
      <AnimatePresence>
        {(sessionState === "recording" || sessionState === "apparatus_showcase") && (
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
              onPause={webcamRecorder.pause}
              onResume={webcamRecorder.resume}
              onToggleMic={() => setMicEnabled((v) => !v)}
              {...(sessionState === "apparatus_showcase"
                ? {
                    phaseLabel: apparatusPhase === "overview"
                      ? "Overview"
                      : `Object ${apparatusObjectCount}`,
                    phaseLabelColor: "var(--sf-yellow)",
                    nextLabel: apparatusPhase === "overview"
                      ? "→ Individual Objects"
                      : "→ Next Object",
                    finishLabel: "✓ Done with Showcase",
                    voiceHint: micEnabled
                      ? <>Say &ldquo;next&rdquo; to advance &middot; Say &ldquo;done&rdquo; to finish showcase</>
                      : <>Voice muted &middot; Double-tap pinch to advance</>,
                    onNextStep: voiceNext,
                    onFinish: voiceFinish,
                    onSkip: handleApparatusSkip,
                  }
                : {
                    onNextStep: handleNextStep,
                    onFinish: handleFinishRequest,
                  }
              )}
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
