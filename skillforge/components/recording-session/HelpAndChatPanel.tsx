"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

type PanelTab = "helpChat" | "notes";

interface HelpAndChatPanelProps {
  visible: boolean;
  currentStepNumber?: number;
  editingStepNumber?: number | null;
  stepNotes?: Record<number, string>;
  onSaveNote?: (stepNumber: number, text: string) => void;
  onEditStep?: (stepNumber: number) => void;
  apparatusActive?: boolean;
}

const GLASS =
  "bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50";

function HelpSection() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--sf-yellow)", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span className="text-sm font-bold text-white">How to Use This</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              <HelpItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                }
                title="Voice Commands"
                items={[
                  'Say "next step" to advance',
                  'Say "finish recording" to end',
                ]}
              />
              <HelpItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
                    <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
                    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
                    <path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                  </svg>
                }
                title="Hand Gestures"
                items={[
                  "Spider-Man gesture (thumb, index, pinky out; right hand) → next step",
                  "Spider-Man gesture (left hand) → previous step",
                ]}
              />
              <HelpItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                }
                title="Buttons"
                items={[
                  "Use the controls at the bottom bar",
                  "Click Next Step, Pause, or Finish",
                ]}
              />
              <div
                className="rounded-xl px-3 py-2.5 text-xs leading-relaxed"
                style={{ backgroundColor: "rgba(168, 85, 247, 0.15)", color: "rgba(255,255,255,0.7)" }}
              >
                Record each step of your task. Mark step boundaries as you go. The AI will process everything when you finish.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HelpItem({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0" style={{ color: "var(--sf-lime)" }}>
        {icon}
      </div>
      <div>
        <p className="text-xs font-bold text-white mb-0.5">{title}</p>
        {items.map((item, i) => (
          <p key={i} className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

function RecordingChat() {
  const [messages, setMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [input, setInput] = useState("");

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg) return;
    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setInput("");
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "AI copilot is observing your recording. I can help with tips once processing begins." },
      ]);
    }, 600);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "var(--sf-lime)" }} />
        <span className="text-sm font-bold text-white">AI Copilot</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center text-center pt-8">
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
              Ask about your recording...
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "ai" && (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 mr-2"
                style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
              >
                A
              </div>
            )}
            <div
              className="max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed"
              style={
                msg.role === "user"
                  ? { backgroundColor: "rgba(168, 85, 247, 0.5)", color: "white" }
                  : { backgroundColor: "rgba(255, 255, 255, 0.08)", color: "rgba(255,255,255,0.8)" }
              }
            >
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the AI copilot..."
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "white",
            }}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-80 disabled:opacity-30"
            style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
          >
            &uarr;
          </button>
        </div>
      </form>
    </div>
  );
}

function StepNoteCard({
  stepNumber,
  note,
  isEditing,
  isCurrent,
  onSaveNote,
  onEditStep,
}: {
  stepNumber: number;
  note: string;
  isEditing: boolean;
  isCurrent: boolean;
  onSaveNote: (stepNumber: number, text: string) => void;
  onEditStep: (stepNumber: number) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.value = note;
      textareaRef.current.focus();
    }
  }, [isEditing, note]);

  if (isEditing) {
    return (
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: isCurrent ? "rgba(168, 85, 247, 0.12)" : "rgba(245, 158, 11, 0.1)",
          border: `1px solid ${isCurrent ? "rgba(168, 85, 247, 0.3)" : "rgba(245, 158, 11, 0.25)"}`,
        }}
      >
        <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5">
          <span
            className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: isCurrent ? "var(--sf-purple)" : "var(--sf-yellow)",
              color: "var(--sf-black)",
            }}
          >
            Step {stepNumber}
          </span>
          {isCurrent && (
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>current</span>
          )}
        </div>
        <div className="px-3 pb-3">
          <textarea
            ref={textareaRef}
            defaultValue={note}
            onChange={(e) => onSaveNote(stepNumber, e.target.value)}
            rows={3}
            placeholder="Add notes for this step..."
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none mt-1"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "white",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
            Notes supplement the voice transcript to improve AI output.
          </p>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => onEditStep(stepNumber)}
      className="w-full rounded-xl px-3 py-2.5 text-left transition-colors"
      style={{
        backgroundColor: isCurrent ? "rgba(168, 85, 247, 0.08)" : "rgba(255,255,255,0.04)",
        border: isCurrent ? "1px solid rgba(168, 85, 247, 0.2)" : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full"
          style={{
            backgroundColor: isCurrent ? "var(--sf-purple)" : "rgba(255,255,255,0.12)",
            color: isCurrent ? "var(--sf-black)" : "rgba(255,255,255,0.5)",
          }}
        >
          Step {stepNumber}
        </span>
        {isCurrent && (
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>current</span>
        )}
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="ml-auto"
          style={{ color: "rgba(255,255,255,0.25)" }}
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: note.trim() ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)" }}>
        {note.trim() || "No notes — tap to add"}
      </p>
    </button>
  );
}

function StepNotesTab({
  currentStepNumber,
  editingStepNumber,
  stepNotes,
  onSaveNote,
  onEditStep,
}: {
  currentStepNumber: number;
  editingStepNumber: number | null;
  stepNotes: Record<number, string>;
  onSaveNote: (stepNumber: number, text: string) => void;
  onEditStep: (stepNumber: number) => void;
}) {
  const allSteps = Array.from({ length: currentStepNumber }, (_, i) => i + 1);
  const activeEditing = editingStepNumber ?? currentStepNumber;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--sf-yellow)" }}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <span className="text-sm font-bold text-white">Step Notes</span>
        <span className="text-[10px] ml-auto" style={{ color: "rgba(255,255,255,0.3)" }}>
          {currentStepNumber} step{currentStepNumber > 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {allSteps.map((stepNum) => (
          <StepNoteCard
            key={stepNum}
            stepNumber={stepNum}
            note={stepNotes[stepNum] ?? ""}
            isEditing={activeEditing === stepNum}
            isCurrent={stepNum === currentStepNumber}
            onSaveNote={onSaveNote}
            onEditStep={onEditStep}
          />
        ))}
      </div>
    </div>
  );
}

function ApparatusNotesTab({
  note,
  onSaveNote,
}: {
  note: string;
  onSaveNote: (text: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = note;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--sf-yellow)" }}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <span className="text-sm font-bold text-white">Apparatus Notes</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.25)",
          }}
        >
          <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5">
            <span
              className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: "var(--sf-yellow)", color: "var(--sf-black)" }}
            >
              Apparatus
            </span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>showcase</span>
          </div>
          <div className="px-3 pb-3">
            <textarea
              ref={textareaRef}
              defaultValue={note}
              onChange={(e) => onSaveNote(e.target.value)}
              rows={4}
              placeholder="List the tools or equipment, add context for the AI..."
              className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none mt-1"
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                color: "white",
              }}
            />
            <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
              Describe the tools/parts being shown. This helps the AI build a better apparatus inventory.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HelpAndChatPanel({
  visible,
  currentStepNumber = 1,
  editingStepNumber,
  stepNotes = {},
  onSaveNote,
  onEditStep,
  apparatusActive = false,
}: HelpAndChatPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("helpChat");

  const handleEditStep = useCallback((stepNumber: number) => {
    setActiveTab("notes");
    onEditStep?.(stepNumber);
  }, [onEditStep]);

  return (
    <div
      className={`fixed top-20 right-20 z-50 w-80 h-[calc(100vh-10rem)] flex flex-col transition-all duration-300 ${GLASS} ${
        visible
          ? "opacity-100 translate-x-0"
          : "opacity-0 translate-x-8 pointer-events-none"
      }`}
    >
      {/* Tab bar */}
      <div className="flex shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <button
          onClick={() => setActiveTab("helpChat")}
          className="flex-1 text-xs font-bold py-2.5 transition-all"
          style={{
            color: activeTab === "helpChat" ? "var(--sf-white)" : "rgba(255,255,255,0.35)",
            borderBottom: activeTab === "helpChat" ? "2px solid var(--sf-purple)" : "2px solid transparent",
          }}
        >
          Help & Chat
        </button>
        <button
          onClick={() => setActiveTab("notes")}
          className="flex-1 text-xs font-bold py-2.5 transition-all"
          style={{
            color: activeTab === "notes" ? "var(--sf-white)" : "rgba(255,255,255,0.35)",
            borderBottom: activeTab === "notes" ? "2px solid var(--sf-yellow)" : "2px solid transparent",
          }}
        >
          {apparatusActive ? "Notes" : "Step Notes"}
        </button>
      </div>

      {activeTab === "helpChat" ? (
        <>
          <HelpSection />
          <RecordingChat />
        </>
      ) : apparatusActive ? (
        <ApparatusNotesTab
          note={stepNotes[0] ?? ""}
          onSaveNote={(text) => onSaveNote?.(0, text)}
        />
      ) : (
        <StepNotesTab
          currentStepNumber={currentStepNumber}
          editingStepNumber={editingStepNumber ?? null}
          stepNotes={stepNotes}
          onSaveNote={onSaveNote ?? (() => {})}
          onEditStep={handleEditStep}
        />
      )}
    </div>
  );
}
