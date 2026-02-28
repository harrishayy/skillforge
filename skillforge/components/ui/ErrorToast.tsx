"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect } from "react";
import { useToastStore } from "@/store/toast-store";

const AUTO_DISMISS_MS = 5000;

function SingleToast({ id, message }: { id: number; message: string }) {
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [id, dismiss]);

  return (
    <motion.div
      layout
      key={id}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
    >
      <div
        className="flex items-start gap-3 px-5 py-3 rounded-2xl shadow-2xl max-w-md cursor-pointer"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(239, 68, 68, 0.35)",
        }}
        onClick={() => dismiss(id)}
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{ backgroundColor: "var(--sf-orange)" }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--sf-black)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
        <span className="text-sm font-bold text-white wrap-break-word">
          {message}
        </span>
      </div>
    </motion.div>
  );
}

export function ErrorToast() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-100 flex flex-col items-center gap-2 pointer-events-auto">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <SingleToast key={t.id} id={t.id} message={t.message} />
        ))}
      </AnimatePresence>
    </div>
  );
}
