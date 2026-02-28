"use client";
import { clsx } from "clsx";

interface ProgressBarProps {
  value: number; // 0-100
  label?: string;
  className?: string;
  color?: "blue" | "green" | "amber";
}

const colorTokens = {
  blue: "var(--sf-purple)",
  green: "var(--sf-lime)",
  amber: "var(--sf-yellow)",
};

export function ProgressBar({ value, label, className, color = "blue" }: ProgressBarProps) {
  return (
    <div className={clsx("w-full", className)}>
      {label && (
        <div className="flex justify-between text-xs mb-1" style={{ color: "#888" }}>
          <span>{label}</span>
          <span>{Math.round(value)}%</span>
        </div>
      )}
      <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ backgroundColor: "#222" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, Math.max(0, value))}%`,
            backgroundColor: colorTokens[color],
          }}
        />
      </div>
    </div>
  );
}
