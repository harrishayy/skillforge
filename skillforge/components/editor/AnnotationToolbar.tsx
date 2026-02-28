"use client";
import { clsx } from "clsx";
import { useEditorStore } from "@/store/editor-store";
import type { EditorTool } from "@/types";

const TOOLS: { id: EditorTool; icon: string; label: string }[] = [
  { id: "select", icon: "↖", label: "Select" },
  { id: "box", icon: "▭", label: "Bounding Box" },
  { id: "arrow", icon: "↗", label: "Arrow" },
  { id: "text", icon: "T", label: "Text Label" },
  { id: "click_target", icon: "⊙", label: "Click Target" },
];

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

export function AnnotationToolbar() {
  const { activeTool, activeColor, setTool, setColor } = useEditorStore();

  return (
    <div
      className="flex items-center gap-3 p-2 rounded-lg"
      style={{ backgroundColor: "#111", border: "1px solid #2a2a2a" }}
    >
      <div className="flex items-center gap-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            onClick={() => setTool(tool.id)}
            className="w-8 h-8 rounded flex items-center justify-center text-sm font-mono transition-colors"
            style={
              activeTool === tool.id
                ? { backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }
                : { color: "#666" }
            }
            onMouseEnter={e => { if (activeTool !== tool.id) e.currentTarget.style.color = "var(--sf-white)"; }}
            onMouseLeave={e => { if (activeTool !== tool.id) e.currentTarget.style.color = "#666"; }}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-6" style={{ backgroundColor: "#2a2a2a" }} />

      <div className="flex items-center gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            title={color}
            onClick={() => setColor(color)}
            className={clsx(
              "w-5 h-5 rounded-full transition-transform",
              activeColor === color ? "scale-125 ring-2 ring-white/50" : "hover:scale-110"
            )}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}
