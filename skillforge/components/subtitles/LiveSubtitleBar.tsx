"use client";

interface LiveSubtitleBarProps {
  liveTranscript: string;
}

export function LiveSubtitleBar({ liveTranscript }: LiveSubtitleBarProps) {
  if (!liveTranscript.trim()) return null;

  return (
    <div className="absolute bottom-52 left-0 right-0 flex justify-center px-4 pointer-events-none z-20">
      <div
        className="max-w-2xl w-full text-center"
        style={{
          backgroundColor: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(4px)",
          borderRadius: "6px",
          padding: "6px 14px",
        }}
      >
        <span className="text-white text-sm font-medium leading-snug">
          {liveTranscript}
        </span>
      </div>
    </div>
  );
}
