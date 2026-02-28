"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ModeSelector } from "@/components/recording/ModeSelector";
import { Button } from "@/components/ui/Button";

type PageState = "idle" | "setup";

export default function RecordPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("idle");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const handleExpertSelect = () => {
    setPageState("setup");
  };

  const handleStartRecording = () => {
    if (!title.trim()) return;
    sessionStorage.setItem(
      "sf-recording-config",
      JSON.stringify({
        title,
        description,
      })
    );
    router.push("/record/session");
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--sf-white)" }}>
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <AnimatePresence mode="wait">
          {pageState === "idle" && (
            <motion.div
              key="role-select"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-2xl"
            >
              <ModeSelector onExpertSelect={handleExpertSelect} />
            </motion.div>
          )}

          {pageState === "setup" && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-lg"
            >
              <h2
                className="font-black mb-6"
                style={{ fontSize: "1.75rem", letterSpacing: "-0.04em", color: "var(--sf-black)" }}
              >
                Training Recording
              </h2>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-bold mb-1" style={{ color: "var(--sf-black)" }}>Workflow Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. How to assemble a circuit board"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ backgroundColor: "var(--sf-white)", border: "1px solid var(--sf-black)", color: "var(--sf-black)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1" style={{ color: "var(--sf-black)" }}>
                    Brief description{" "}
                    <span style={{ color: "var(--sf-gray)", fontWeight: 400 }}>(helps the AI guide you step by step)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="e.g. Demonstrate how to solder components and test the board"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none resize-none"
                    style={{ backgroundColor: "var(--sf-white)", border: "1px solid var(--sf-black)", color: "var(--sf-black)" }}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setPageState("idle")}>
                  ← Back
                </Button>
                <Button
                  onClick={handleStartRecording}
                  disabled={!title.trim()}
                  className="flex-1"
                >
                  Start Guided Recording
                </Button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
