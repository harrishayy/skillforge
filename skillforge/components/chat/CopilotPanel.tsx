"use client";
import type { Step } from "@/types";
import { StepContext } from "./StepContext";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";

interface CopilotPanelProps {
  currentStep: Step | null;
  onSendMessage: (message: string) => void;
  isCopilotListening?: boolean;
}

export function CopilotPanel({ currentStep, onSendMessage, isCopilotListening }: CopilotPanelProps) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--sf-black)", borderLeft: "1px solid #222" }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid #222" }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "var(--sf-lime)" }} />
        <span className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>AI Copilot</span>
        <span className="text-xs ml-auto" style={{ color: "#555" }}>Powered by Claude</span>
      </div>

      {isCopilotListening && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 animate-pulse"
          style={{ backgroundColor: "rgba(139, 92, 246, 0.12)", borderBottom: "1px solid rgba(139, 92, 246, 0.3)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(139, 92, 246, 0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          <span className="text-xs font-medium" style={{ color: "rgba(139, 92, 246, 0.9)" }}>
            Listening for Claude&hellip;
          </span>
        </div>
      )}

      <StepContext step={currentStep} />
      <ChatMessages />
      <ChatInput onSend={onSendMessage} />
    </div>
  );
}
