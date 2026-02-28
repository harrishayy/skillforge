"use client";

import { useState } from "react";
import { ImmersiveToolbar, type OverlayPanels } from "./ImmersiveToolbar";

const GLASS =
  "bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50";

interface ImmersiveOverlayProps {
  modeBadges: Array<{ label: string; color: string }>;
  panels: OverlayPanels;
  onTogglePanel: (panel: keyof OverlayPanels) => void;
  onExit: () => void;
  optionsContent: React.ReactNode;
  statsContent: React.ReactNode;
}

function LiveChat() {
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
        { role: "ai", text: "Chat integration coming soon. Detection is running in the background." },
      ]);
    }, 600);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "var(--sf-lime)" }} />
        <span className="text-sm font-bold text-white">AI Copilot</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-center pt-12">
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
              Ask about what&apos;s on screen...
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

      <form onSubmit={handleSend} className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this view..."
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

export function ImmersiveOverlay({
  modeBadges,
  panels,
  onTogglePanel,
  onExit,
  optionsContent,
  statsContent,
}: ImmersiveOverlayProps) {
  return (
    <>
      {/* Immersive LIVE badge + mode badges */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-3">
        <div
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white ${GLASS}`}
        >
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
          LIVE
        </div>
        {modeBadges.map((b) => (
          <span
            key={b.label}
            className="text-white text-xs px-2.5 py-1 rounded-full"
            style={{ backgroundColor: b.color }}
          >
            {b.label}
          </span>
        ))}
      </div>

      {/* Floating options panel (left) */}
      <div
        className={`fixed top-20 left-4 z-50 w-72 max-h-[calc(100vh-7rem)] overflow-y-auto transition-all duration-300 ${GLASS} ${
          panels.options
            ? "opacity-100 translate-x-0"
            : "opacity-0 -translate-x-8 pointer-events-none"
        }`}
      >
        {optionsContent}
      </div>

      {/* Floating chat panel (right, offset for toolbar) */}
      <div
        className={`fixed top-20 right-20 z-50 w-80 h-[calc(100vh-7rem)] transition-all duration-300 ${GLASS} ${
          panels.chat
            ? "opacity-100 translate-x-0"
            : "opacity-0 translate-x-8 pointer-events-none"
        }`}
      >
        <LiveChat />
      </div>

      {/* Floating stats bar (bottom center) */}
      <div
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${GLASS} px-6 py-3 ${
          panels.stats
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        {statsContent}
      </div>

      {/* Right-edge toolbar (always visible) */}
      <ImmersiveToolbar panels={panels} onTogglePanel={onTogglePanel} onExit={onExit} />
    </>
  );
}
