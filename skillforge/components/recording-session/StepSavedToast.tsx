"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

interface StepSavedToastProps {
  stepNumber: number | null;
}

export function StepSavedToast({ stepNumber }: StepSavedToastProps) {
  const [visible, setVisible] = useState(false);
  const [displayStep, setDisplayStep] = useState<number | null>(null);

  useEffect(() => {
    if (stepNumber === null) return;
    setDisplayStep(stepNumber);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [stepNumber]);

  return (
    <AnimatePresence>
      {visible && displayStep !== null && (
        <motion.div
          key={`toast-${displayStep}-${stepNumber}`}
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed top-6 left-1/2 -translate-x-1/2 z-60"
        >
          <div
            className="flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.6)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(199, 255, 105, 0.3)",
            }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: "var(--sf-lime)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white">
              Step {displayStep} saved!
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
