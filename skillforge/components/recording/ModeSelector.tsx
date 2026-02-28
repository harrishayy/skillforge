"use client";
import { motion } from "framer-motion";
import Link from "next/link";

interface ModeSelectorProps {
  onExpertSelect: () => void;
}

export function ModeSelector({ onExpertSelect }: ModeSelectorProps) {
  return (
    <div className="flex flex-col items-center gap-8">
      <div>
        <h2
          className="font-black text-center mb-2"
          style={{ fontSize: "2rem", letterSpacing: "-0.04em", color: "var(--sf-black)" }}
        >
          What would you like to do?
        </h2>
        <p className="text-center text-sm" style={{ color: "var(--sf-gray)" }}>
          Record an expert workflow or learn from existing recordings
        </p>
      </div>

      <div
        className="grid grid-cols-2 w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ border: "1px solid var(--sf-black)" }}
      >
        <RoleCard
          icon="🎬"
          title="Expert Recording"
          description="Record a task via webcam with hand tracking and object detection. AI builds an annotated workflow automatically."
          bg="var(--sf-purple)"
          onClick={onExpertSelect}
        />
        <Link href="/library" className="block">
          <RoleCard
            icon="🎓"
            title="Learning Trainee"
            description="Browse and watch expert recordings with live AI annotations, bounding boxes, and a Claude copilot guide."
            bg="var(--sf-lime)"
            borderLeft
          />
        </Link>
      </div>
    </div>
  );
}

function RoleCard({
  icon,
  title,
  description,
  bg,
  onClick,
  borderLeft,
}: {
  icon: string;
  title: string;
  description: string;
  bg: string;
  onClick?: () => void;
  borderLeft?: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className="flex flex-col items-start gap-4 p-8 text-left cursor-pointer transition-opacity hover:opacity-90 h-full"
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
