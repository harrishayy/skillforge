"use client";

import { motion, AnimatePresence } from "framer-motion";

interface SubtitleOverlayProps {
  transcript: string;
  visible: boolean;
}

export function SubtitleOverlay({ transcript, visible }: SubtitleOverlayProps) {
  const text = transcript.trim();
  const show = visible && text.length > 0;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 max-w-[70%] pointer-events-none"
        >
          <div
            className="px-5 py-2.5 rounded-xl text-center text-sm leading-relaxed"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.6)",
              color: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            {text}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
