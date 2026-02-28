"use client";
import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types";
import { Spinner } from "@/components/ui/Spinner";
import { usePlayerStore } from "@/store/player-store";

export function ChatMessages() {
  const { chatHistory, isCopilotLoading } = usePlayerStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  if (!chatHistory.length) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-center">
        <div>
          <p className="text-2xl mb-2">💬</p>
          <p className="text-sm" style={{ color: "#555" }}>Ask me anything about this step</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {chatHistory.map((msg, i) => (
        <ChatBubble key={i} message={msg} />
      ))}
      {isCopilotLoading && chatHistory[chatHistory.length - 1]?.role !== "assistant" && (
        <div className="flex items-center gap-2 text-sm" style={{ color: "#666" }}>
          <span style={{ color: "var(--sf-lime)" }}><Spinner className="w-3 h-3" /></span>
          <span>Thinking...</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
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
          isUser
            ? { backgroundColor: "var(--sf-purple)", color: "var(--sf-white)" }
            : { backgroundColor: "#1a1a1a", color: "#ccc", borderBottomLeftRadius: "2px" }
        }
      >
        {message.content || <span style={{ opacity: 0.5 }}>...</span>}
      </div>
    </div>
  );
}
