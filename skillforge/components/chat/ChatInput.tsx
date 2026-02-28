"use client";
import { useState } from "react";
import { usePlayerStore } from "@/store/player-store";

interface ChatInputProps {
  onSend: (message: string) => void;
}

export function ChatInput({ onSend }: ChatInputProps) {
  const [value, setValue] = useState("");
  const { isCopilotLoading } = usePlayerStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = value.trim();
    if (!msg || isCopilotLoading) return;
    setValue("");
    onSend(msg);
  };

  return (
    <form onSubmit={handleSubmit} className="p-3" style={{ borderTop: "1px solid #222" }}>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask about this step..."
          disabled={isCopilotLoading}
          className="flex-1 rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
          style={{
            backgroundColor: "#111",
            border: "1px solid #333",
            color: "var(--sf-white)",
          }}
        />
        <button
          type="submit"
          disabled={isCopilotLoading || !value.trim()}
          className="px-3 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" }}
        >
          ↑
        </button>
      </div>
    </form>
  );
}
