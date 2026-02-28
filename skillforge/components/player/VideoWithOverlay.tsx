"use client";
import { useRef, useEffect } from "react";
import type { Step } from "@/types";
import { OverlayCanvas } from "./OverlayCanvas";
import { SubtitleOverlay } from "@/components/subtitles/SubtitleOverlay";
import { videoUrl } from "@/lib/constants";
import { usePlayerStore } from "@/store/player-store";
import { useSubtitles } from "@/hooks/useSubtitles";

interface VideoWithOverlayProps {
  videoPath: string;
  steps: Step[];
  workflowId: string;
  onStepChange?: (stepIndex: number) => void;
}

export function VideoWithOverlay({
  videoPath,
  steps,
  workflowId,
  onStepChange,
}: VideoWithOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const { setIsPlaying, currentStepIndex } = usePlayerStore();
  const currentStepId = steps[currentStepIndex]?.id ?? null;
  const currentSubtitle = useSubtitles(currentStepId, videoRef);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, [setIsPlaying]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <video
        ref={videoRef}
        src={videoUrl(videoPath)}
        className="w-full h-full object-contain"
        controls
        playsInline
      />
      <OverlayCanvas
        videoRef={videoRef}
        steps={steps}
        workflowId={workflowId}
        onStepChange={onStepChange}
      />
      <SubtitleOverlay currentSubtitle={currentSubtitle} />
    </div>
  );
}
