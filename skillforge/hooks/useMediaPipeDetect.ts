"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HandLandmarker, ObjectDetector } from "@mediapipe/tasks-vision";
import type { HandData, YoloDetection } from "./useLiveDetect";
import { showErrorToast } from "@/store/toast-store";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const OBJECT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

// Module-level singleton — WASM is loaded once per page lifecycle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _visionPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getVision(): Promise<any> {
  if (!_visionPromise) {
    _visionPromise = import("@mediapipe/tasks-vision").then(({ FilesetResolver }) =>
      FilesetResolver.forVisionTasks(WASM_CDN)
    );
  }
  return _visionPromise;
}

export interface MPResult {
  hands: HandData | null;
  /** Object detections from MediaPipe EfficientDet, same shape as YoloDetection */
  mp_detections: YoloDetection[];
  processing_ms: number;
}

interface UseMediaPipeDetectOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  handsEnabled: boolean;
  objectsEnabled: boolean;
  enabled: boolean;
  onResult: (r: MPResult) => void;
}

/**
 * Runs MediaPipe HandLandmarker and/or ObjectDetector on every video frame
 * directly in the browser — zero network latency, true real-time detection.
 */
export function useMediaPipeDetect({
  videoRef,
  handsEnabled,
  objectsEnabled,
  enabled,
  onResult,
}: UseMediaPipeDetectOptions) {
  const [mpLoading, setMpLoading] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);

  const hlRef = useRef<HandLandmarker | null>(null);
  const odRef = useRef<ObjectDetector | null>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);

  // Keep onResult stable across renders
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // ── Load HandLandmarker ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !handsEnabled || hlRef.current) return;
    let cancelled = false;
    setMpLoading(true);

    getVision()
      .then(async (vision) => {
        if (cancelled) return;
        const { HandLandmarker } = await import("@mediapipe/tasks-vision");
        const opts = {
          runningMode: "VIDEO" as const,
          numHands: 2,
        };
        try {
          hlRef.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
            ...opts,
          });
        } catch {
          // GPU delegate unavailable — fall back to CPU
          hlRef.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: "CPU" },
            ...opts,
          });
        }
        if (!cancelled) setMpLoading(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "MediaPipe hand model failed to load";
          showErrorToast(`MediaPipe hand model: ${msg}`);
          setMpError(msg);
          setMpLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, handsEnabled]);

  // ── Load ObjectDetector ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !objectsEnabled || odRef.current) return;
    let cancelled = false;
    setMpLoading(true);

    getVision()
      .then(async (vision) => {
        if (cancelled) return;
        const { ObjectDetector } = await import("@mediapipe/tasks-vision");
        const opts = {
          runningMode: "VIDEO" as const,
          scoreThreshold: 0.35,
        };
        try {
          odRef.current = await ObjectDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: OBJECT_MODEL, delegate: "GPU" },
            ...opts,
          });
        } catch {
          odRef.current = await ObjectDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: OBJECT_MODEL, delegate: "CPU" },
            ...opts,
          });
        }
        if (!cancelled) setMpLoading(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "MediaPipe object model failed to load";
          showErrorToast(`MediaPipe object model: ${msg}`);
          setMpError(msg);
          setMpLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, objectsEnabled]);

  // ── Per-frame detection loop ───────────────────────────────────────────────
  const detect = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      if (enabled) rafRef.current = requestAnimationFrame(detect);
      return;
    }

    // Skip if the video hasn't advanced to a new frame yet
    const currentTime = video.currentTime;
    if (currentTime === lastVideoTimeRef.current) {
      rafRef.current = requestAnimationFrame(detect);
      return;
    }
    lastVideoTimeRef.current = currentTime;

    const t0 = performance.now();
    // MediaPipe VIDEO mode requires a monotonically increasing timestamp in ms
    const ts = currentTime * 1000;

    let handData: HandData | null = null;
    let mpDetections: YoloDetection[] = [];

    // Hand landmark detection (landmarks always x, y, z; handedness per hand)
    if (handsEnabled && hlRef.current) {
      const r = hlRef.current.detectForVideo(video, ts);
      handData = {
        hand_count: r.landmarks.length,
        hands: r.landmarks.map((lms, i) => {
          const handedness = r.handedness?.[i]?.[0]?.categoryName as "Left" | "Right" | undefined;
          return {
            landmarks: lms.map((lm) => ({
              x: lm.x * 100,
              y: lm.y * 100,
              z: lm.z,
            })),
            ...(handedness === "Left" || handedness === "Right" ? { handedness } : {}),
          };
        }),
        pointing_at:
          r.landmarks[0]
            ? { x: r.landmarks[0][8].x * 100, y: r.landmarks[0][8].y * 100 }
            : null,
      };
    }

    // Object detection
    if (objectsEnabled && odRef.current) {
      const r = odRef.current.detectForVideo(video, ts);
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      mpDetections = r.detections.map((det) => ({
        class: det.categories[0]?.categoryName ?? "unknown",
        confidence: det.categories[0]?.score ?? 0,
        // MediaPipe returns pixel coords; convert to 0–100 for the renderer
        bbox_x: ((det.boundingBox?.originX ?? 0) / vw) * 100,
        bbox_y: ((det.boundingBox?.originY ?? 0) / vh) * 100,
        bbox_width: ((det.boundingBox?.width ?? 0) / vw) * 100,
        bbox_height: ((det.boundingBox?.height ?? 0) / vh) * 100,
      }));
    }

    onResultRef.current({
      hands: handData,
      mp_detections: mpDetections,
      processing_ms: Math.round(performance.now() - t0),
    });

    rafRef.current = requestAnimationFrame(detect);
  }, [videoRef, handsEnabled, objectsEnabled, enabled]);

  // Start / stop the loop
  useEffect(() => {
    if (enabled) {
      rafRef.current = requestAnimationFrame(detect);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, detect]);

  // Cleanup models on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      hlRef.current?.close();
      odRef.current?.close();
      hlRef.current = null;
      odRef.current = null;
    };
  }, []);

  return { mpLoading, mpError };
}
