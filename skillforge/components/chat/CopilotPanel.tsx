"use client";
import type { Step } from "@/types";
import { StepContext } from "./StepContext";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";

interface CopilotPanelProps {
  currentStep: Step | null;
  onSendMessage: (message: string) => void;
}

export function CopilotPanel({ currentStep, onSendMessage }: CopilotPanelProps) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--sf-black)", borderLeft: "1px solid #222" }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid #222" }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "var(--sf-lime)" }} />
        <span className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>AI Copilot</span>
        <span className="text-xs ml-auto" style={{ color: "#555" }}>Powered by Claude</span>
      </div>

      <StepContext step={currentStep} />
      <ChatMessages />
      <ChatInput onSend={onSendMessage} />
    </div>
  );
}
