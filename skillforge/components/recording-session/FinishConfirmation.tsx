"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

interface FinishConfirmationProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Seconds before auto-dismiss */
  timeoutSeconds?: number;
}

export function FinishConfirmation({
  visible,
  onConfirm,
  onCancel,
  timeoutSeconds = 5,
}: FinishConfirmationProps) {
  const [countdown, setCountdown] = useState(timeoutSeconds);

  useEffect(() => {
    if (!visible) {
      setCountdown(timeoutSeconds);
      return;
    }
    setCountdown(timeoutSeconds);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onCancel();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, timeoutSeconds, onCancel]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-60 w-full max-w-xl px-4"
        >
          <div
            className="rounded-2xl shadow-2xl overflow-hidden"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: "1px solid rgba(255, 109, 56, 0.4)",
            }}
          >
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "var(--sf-orange)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" x2="12" y1="9" y2="13" />
                    <line x1="12" x2="12.01" y1="17" y2="17" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white">
                    Finish recording?
                  </p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                    Say &ldquo;finish recording&rdquo;, gesture, or click again to confirm
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 text-sm font-bold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-80"
                  style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "var(--sf-white)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 text-sm font-bold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-80"
                  style={{ backgroundColor: "var(--sf-orange)", color: "var(--sf-black)" }}
                >
                  ■ Confirm Finish
                </button>
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold tabular-nums"
                  style={{
                    backgroundColor: "rgba(255,109,56,0.2)",
                    color: "var(--sf-orange)",
                    border: "2px solid var(--sf-orange)",
                  }}
                >
                  {countdown}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
