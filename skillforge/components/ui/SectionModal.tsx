"use client";
import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface SectionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  accentColor?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function SectionModal({
  open,
  onClose,
  title,
  accentColor = "var(--sf-purple)",
  icon,
  children,
}: SectionModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-100"
            style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-101 flex items-center justify-center p-8 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
              style={{ backgroundColor: "#0a0a0a", border: "1px solid #222" }}
            >
              {/* Header */}
              <div
                className="flex items-center gap-2.5 px-5 py-3.5 shrink-0"
                style={{ borderBottom: `1px solid ${accentColor}33` }}
              >
                {icon && (
                  <span style={{ color: accentColor }}>{icon}</span>
                )}
                <h2 className="text-sm font-bold flex-1" style={{ color: "var(--sf-white)" }}>
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg transition-colors"
                  style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "#888" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sf-white)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
                >
                  Esc
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5">
                {children}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
