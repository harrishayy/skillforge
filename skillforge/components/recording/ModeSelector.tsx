"use client";
import { motion } from "framer-motion";
import type { TaskMode } from "@/types";

interface ModeSelectorProps {
  onSelect: (mode: TaskMode) => void;
}

export function ModeSelector({ onSelect }: ModeSelectorProps) {
  return (
    <div className="flex flex-col items-center gap-8">
      <div>
        <h2
          className="font-black text-center mb-2"
          style={{ fontSize: "2rem", letterSpacing: "-0.04em", color: "var(--sf-black)" }}
        >
          Choose Recording Mode
        </h2>
        <p className="text-center text-sm" style={{ color: "var(--sf-gray)" }}>
          Select what type of task you are recording for trainees
        </p>
      </div>

      <div
        className="grid grid-cols-2 w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ border: "1px solid var(--sf-black)" }}
      >
        <ModeCard
          mode="software"
          icon="💻"
          title="Software Task"
          description="Record your screen with keyboard and mouse tracking. Best for software tools, workflows, and digital processes."
          bg="var(--sf-purple)"
          onSelect={() => onSelect("software")}
        />
        <ModeCard
          mode="hardware"
          icon="🔧"
          title="Hardware Task"
          description="Record via webcam with hand tracking. Best for physical assembly, lab work, and hands-on procedures."
          bg="var(--sf-yellow)"
          onSelect={() => onSelect("hardware")}
          borderLeft
        />
      </div>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  description,
  bg,
  onSelect,
  borderLeft,
}: {
  mode: TaskMode;
  icon: string;
  title: string;
  description: string;
  bg: string;
  onSelect: () => void;
  borderLeft?: boolean;
}) {
  return (
    <motion.button
      onClick={onSelect}
      whileTap={{ scale: 0.98 }}
      className="flex flex-col items-start gap-4 p-8 text-left cursor-pointer transition-opacity hover:opacity-90"
      style={{
        backgroundColor: bg,
        color: "var(--sf-black)",
        borderLeft: borderLeft ? "1px solid var(--sf-black)" : undefined,
      }}
    >
      <span className="text-4xl">{icon}</span>
      <div>
        <h3 className="font-black text-lg mb-1" style={{ letterSpacing: "-0.02em" }}>{title}</h3>
        <p className="text-sm leading-relaxed" style={{ color: "rgba(0,0,0,0.6)" }}>{description}</p>
      </div>
      <span className="mt-auto text-sm font-bold flex items-center gap-1">
        Select →
      </span>
    </motion.button>
  );
}
