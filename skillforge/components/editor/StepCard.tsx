"use client";
import { useState, useEffect } from "react";
import type { Step } from "@/types";
import { useWorkflowStore } from "@/store/workflow-store";
import { msToTimestamp } from "@/lib/video-utils";

interface StepCardProps {
  step: Step;
  isSelected: boolean;
  onSelect: () => void;
}

export function StepCard({ step, isSelected, onSelect }: StepCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  const { saveStep } = useWorkflowStore();

  useEffect(() => {
    if (!isEditing) setTitle(step.title);
  }, [step.title, isEditing]);

  const handleSaveTitle = async () => {
    setIsEditing(false);
    if (title !== step.title) {
      await saveStep(step.id, { title });
    }
  };

  return (
    <div
      onClick={onSelect}
      className="group p-3 rounded-lg cursor-pointer transition-all"
      style={{
        border: isSelected ? "1px solid var(--sf-purple)" : "1px solid #222",
        backgroundColor: isSelected ? "rgba(122,120,255,0.08)" : "#0d0d0d",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-mono w-6" style={{ color: "#555" }}>{step.step_number}</span>
        {isEditing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
            className="flex-1 text-sm rounded px-2 py-0.5 outline-none"
            style={{ backgroundColor: "#1a1a1a", color: "var(--sf-white)", border: "1px solid #444" }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium truncate"
            style={{ color: isSelected ? "var(--sf-white)" : "#aaa" }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {step.title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs ml-8" style={{ color: "#666" }}>
        {(step.workflow_start_ms > 0 || step.workflow_end_ms > 0) ? (
          <>
            <span className="font-mono" style={{ color: "#777" }}>{msToTimestamp(step.workflow_start_ms)}</span>
            <span style={{ color: "#555" }}>→</span>
            <span className="font-mono" style={{ color: "#777" }}>{msToTimestamp(step.workflow_end_ms)}</span>
          </>
        ) : step.end_ms > 0 ? (
          <span className="font-mono" style={{ color: "#777" }}>{msToTimestamp(step.end_ms)}</span>
        ) : null}
        <span className="ml-auto">{step.annotations.length} ann.</span>
      </div>
    </div>
  );
}
