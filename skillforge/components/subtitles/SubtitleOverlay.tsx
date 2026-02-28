"use client";
import { useEffect, useRef } from "react";
import type { SubtitleSegment } from "@/types";

interface SubtitleOverlayProps {
  currentSubtitle: SubtitleSegment | null;
}

export function SubtitleOverlay({ currentSubtitle }: SubtitleOverlayProps) {
  const prevTextRef = useRef<string | null>(null);

  useEffect(() => {
    prevTextRef.current = currentSubtitle?.text ?? null;
  });

  if (!currentSubtitle) return null;

  return (
    <div
      className="absolute bottom-12 left-0 right-0 flex justify-center px-4 pointer-events-none z-10"
      style={{ transition: "opacity 0.2s ease" }}
    >
      <div
        key={currentSubtitle.id}
        className="max-w-2xl w-full text-center"
        style={{
          backgroundColor: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(4px)",
          borderRadius: "6px",
          padding: "6px 14px",
          animation: "subtitle-fade-in 0.15s ease",
        }}
      >
        <span className="text-white text-sm font-medium leading-snug">
          {currentSubtitle.text}
        </span>
      </div>
      <style>{`
        @keyframes subtitle-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
