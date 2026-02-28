"use client";
import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { useReviewStore } from "@/store/review-store";
import { frameUrl } from "@/lib/constants";
import type { ReviewStepStatus } from "@/types";

const STATUS_RING: Record<ReviewStepStatus, string> = {
  pending: "#555",
  approved: "var(--sf-lime)",
  refilm: "var(--sf-orange)",
};

const STATUS_ICON: Record<ReviewStepStatus, string> = {
  pending: "",
  approved: "✓",
  refilm: "↻",
};

export function StepStrip() {
  const { workflow, activeStepIndex, setActiveStep, stepStates } =
    useReviewStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current?.children[activeStepIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeStepIndex]);

  if (!workflow) return null;

  return (
    <div
      className="flex items-center gap-3 px-6 py-3 overflow-x-auto scrollbar-hide"
      ref={scrollRef}
      style={{ borderBottom: "1px solid #222" }}
    >
      {workflow.steps.map((step, i) => {
        const isActive = i === activeStepIndex;
        const ps = stepStates[step.id];
        const status = ps?.status ?? "pending";

        return (
          <motion.button
            key={step.id}
            onClick={() => setActiveStep(i)}
            className="shrink-0 flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors cursor-pointer"
            style={{
              backgroundColor: isActive ? "#1a1a1a" : "transparent",
              border: `2px solid ${isActive ? "var(--sf-purple)" : STATUS_RING[status]}`,
              minWidth: 100,
            }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
          >
            {step.key_frame_path ? (
              <img
                src={frameUrl(step.key_frame_path)}
                alt={`Step ${step.step_number}`}
                className="w-20 h-12 rounded object-cover"
                style={{ border: "1px solid #333" }}
              />
            ) : (
              <div
                className="w-20 h-12 rounded flex items-center justify-center text-xs"
                style={{ backgroundColor: "#222", color: "#555" }}
              >
                No frame
              </div>
            )}
            <div className="flex items-center gap-1">
              <span
                className="text-[10px] font-bold"
                style={{ color: isActive ? "var(--sf-white)" : "#888" }}
              >
                Step {step.step_number}
              </span>
              {STATUS_ICON[status] && (
                <span
                  className="text-[10px] font-bold"
                  style={{ color: STATUS_RING[status] }}
                >
                  {STATUS_ICON[status]}
                </span>
              )}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
