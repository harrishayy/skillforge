"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

type PageState = "expert-menu" | "setup";

export default function ExpertSetupPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("expert-menu");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const handleStartRecording = () => {
    if (!title.trim()) return;
    sessionStorage.setItem(
      "sf-recording-config",
      JSON.stringify({ title, description })
    );
    router.push("/record/session");
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <AnimatePresence mode="wait">
        {pageState === "expert-menu" && (
          <motion.div
            key="expert-menu"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-2xl"
          >
            <div className="flex flex-col items-center gap-8">
              <div>
                <h2
                  className="font-black text-center mb-2"
                  style={{ fontSize: "2rem", letterSpacing: "-0.04em", color: "var(--sf-black)" }}
                >
                  Expert Workflows
                </h2>
                <p className="text-center text-sm" style={{ color: "var(--sf-gray)" }}>
                  Create a new workflow or browse your existing recordings
                </p>
              </div>

              <div
                className="grid grid-cols-2 w-full max-w-2xl rounded-2xl overflow-hidden"
                style={{ border: "1px solid var(--sf-black)" }}
              >
                <motion.button
                  onClick={() => setPageState("setup")}
                  whileTap={{ scale: 0.98 }}
                  className="flex flex-col items-start gap-4 p-8 text-left cursor-pointer transition-opacity hover:opacity-90 h-full"
                  style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
                >
                  <span className="text-4xl">🎬</span>
                  <div>
                    <h3 className="font-black text-lg mb-1" style={{ letterSpacing: "-0.02em" }}>Create New Workflow</h3>
                    <p className="text-sm leading-relaxed" style={{ color: "rgba(0,0,0,0.6)" }}>
                      Record a task via webcam with hand tracking and object detection. AI builds an annotated workflow automatically.
                    </p>
                  </div>
                  <span className="mt-auto text-sm font-bold flex items-center gap-1">
                    Select →
                  </span>
                </motion.button>

                <Link href="/workflows" className="block">
                  <motion.div
                    whileTap={{ scale: 0.98 }}
                    className="flex flex-col items-start gap-4 p-8 text-left cursor-pointer transition-opacity hover:opacity-90 h-full"
                    style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)", borderLeft: "1px solid var(--sf-black)" }}
                  >
                    <span className="text-4xl">📂</span>
                    <div>
                      <h3 className="font-black text-lg mb-1" style={{ letterSpacing: "-0.02em" }}>Browse Workflows</h3>
                      <p className="text-sm leading-relaxed" style={{ color: "rgba(0,0,0,0.6)" }}>
                        View, edit, and manage your existing workflow recordings. Pick up where you left off.
                      </p>
                    </div>
                    <span className="mt-auto text-sm font-bold flex items-center gap-1">
                      Select →
                    </span>
                  </motion.div>
                </Link>
              </div>

              <Button variant="ghost" onClick={() => router.push("/record")}>
                ← Back
              </Button>
            </div>
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
              New Recording
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
              <Button variant="ghost" onClick={() => setPageState("expert-menu")}>
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
  );
}
