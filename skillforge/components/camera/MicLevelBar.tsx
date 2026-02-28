interface MicLevelBarProps {
  level: number; // 0–100
  label?: string;
}

/** Animated microphone amplitude bar (green → amber → red). */
export function MicLevelBar({ level, label = "Microphone" }: MicLevelBarProps) {
  const color =
    level > 70 ? "#ef4444" : level > 40 ? "#f59e0b" : "#10b981";

  return (
    <div>
      {label && (
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          {label}
        </h3>
      )}
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-75"
          style={{ width: `${level}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
