"use client";
import { useState, useEffect, useRef, RefObject } from "react";
import type { SubtitleSegment } from "@/types";
import { getStepSubtitles } from "@/lib/api-client";

export function useSubtitles(
  stepId: string | null | undefined,
  videoRef: RefObject<HTMLVideoElement>
): SubtitleSegment | null {
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<SubtitleSegment | null>(null);
  const rafRef = useRef<number>(0);

  // Fetch subtitles whenever stepId changes
  useEffect(() => {
    setSubtitles([]);
    setCurrentSubtitle(null);
    if (!stepId) return;

    let cancelled = false;
    getStepSubtitles(stepId)
      .then((segs) => { if (!cancelled) setSubtitles(segs); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [stepId]);

  // Track video currentTime via requestAnimationFrame
  useEffect(() => {
    const video = videoRef.current;
    if (!video || subtitles.length === 0) {
      setCurrentSubtitle(null);
      return;
    }

    const tick = () => {
      const currentMs = video.currentTime * 1000;
      const active = subtitles.find(
        (s) => currentMs >= s.start_ms && currentMs < s.end_ms
      ) ?? null;
      setCurrentSubtitle(active);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [subtitles, videoRef]);

  return currentSubtitle;
}
