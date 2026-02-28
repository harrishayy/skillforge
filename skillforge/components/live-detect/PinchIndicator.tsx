"use client";

interface PinchIndicatorProps {
  leftPressed: boolean;
  rightPressed: boolean;
}

/**
 * Simple L / R indicator that highlights when left or right hand pinch is detected.
 */
export function PinchIndicator({ leftPressed, rightPressed }: PinchIndicatorProps) {
  return (
    <div className="flex items-center gap-2" style={{ color: "#555" }}>
      <span className="text-xs font-medium">Pinch:</span>
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-colors"
        style={{
          backgroundColor: leftPressed ? "var(--sf-lime)" : "#222",
          color: leftPressed ? "var(--sf-black)" : "#666",
          border: `1px solid ${leftPressed ? "var(--sf-lime)" : "#333"}`,
        }}
        aria-label={leftPressed ? "Left hand pressing" : "Left hand"}
      >
        L
      </span>
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-colors"
        style={{
          backgroundColor: rightPressed ? "var(--sf-lime)" : "#222",
          color: rightPressed ? "var(--sf-black)" : "#666",
          border: `1px solid ${rightPressed ? "var(--sf-lime)" : "#333"}`,
        }}
        aria-label={rightPressed ? "Right hand pressing" : "Right hand"}
      >
        R
      </span>
    </div>
  );
}
