"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useReviewStore } from "@/store/review-store";
import { Button } from "@/components/ui/Button";
import type { Step } from "@/types";

interface RefilmBannerProps {
  step: Step;
  workflowId: string;
}

export function RefilmBanner({ step, workflowId }: RefilmBannerProps) {
  const { stepStates, resetStepStatus } = useReviewStore();
  const ps = stepStates[step.id];

  if (ps?.status !== "refilm") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between rounded-xl px-4 py-3"
      style={{ backgroundColor: "rgba(255,109,56,0.1)", border: "1px solid rgba(255,109,56,0.3)" }}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm" style={{ color: "var(--sf-orange)" }}>↻</span>
        <div>
          <p className="text-xs font-bold" style={{ color: "var(--sf-orange)" }}>
            Marked for re-filming
          </p>
          <p className="text-[10px]" style={{ color: "#888" }}>
            Record a new version of this step only.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => resetStepStatus(step.id)}
          className="text-[10px] font-medium px-2 py-1 rounded transition-colors"
          style={{ color: "#888" }}
        >
          Cancel
        </button>
        <Link href={`/review/${workflowId}/refilm/${step.id}`}>
          <Button size="sm" variant="secondary">
            Start Re-film
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}
