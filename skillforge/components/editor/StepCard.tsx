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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(step.title);
  const { saveStep, deleteStepById, deletingStepId } = useWorkflowStore();
  const isDeleting = deletingStepId === step.id;

  useEffect(() => {
    if (!isEditing) setTitle(step.title);
  }, [step.title, isEditing]);

  useEffect(() => {
    if (!isSelected) setConfirmDelete(false);
  }, [isSelected]);

  const handleSaveTitle = async () => {
    setIsEditing(false);
    if (title !== step.title) {
      await saveStep(step.id, { title });
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      deleteStepById(step.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  return (
    <div
      onClick={onSelect}
      className="group p-3 rounded-lg cursor-pointer transition-all relative"
      style={{
        border: isSelected ? "1px solid var(--sf-purple)" : "1px solid #222",
        backgroundColor: isSelected ? "rgba(122,120,255,0.08)" : "#0d0d0d",
        opacity: isDeleting ? 0.5 : 1,
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
        {!isEditing && !confirmDelete && (
          <button
            onClick={handleDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-white/10"
            title="Delete step"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {confirmDelete && (
        <div
          className="flex items-center gap-2 mt-1.5 ml-8 p-1.5 rounded-md"
          style={{ backgroundColor: "rgba(255,100,50,0.08)", border: "1px solid rgba(255,100,50,0.2)" }}
        >
          <span className="text-[11px]" style={{ color: "var(--sf-orange)" }}>Delete this step?</span>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-[11px] font-bold px-2 py-0.5 rounded transition-colors"
            style={{ backgroundColor: "var(--sf-orange)", color: "var(--sf-black)" }}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
          <button
            onClick={handleCancelDelete}
            className="text-[11px] font-medium px-2 py-0.5 rounded transition-colors"
            style={{ color: "#888" }}
          >
            Cancel
          </button>
        </div>
      )}

      {!confirmDelete && step.end_ms > 0 && (
        <div className="flex items-center gap-2 text-xs ml-8" style={{ color: "#666" }}>
          <span className="font-mono" style={{ color: "#777" }}>{msToTimestamp(step.start_ms)}</span>
          <span style={{ color: "#555" }}>→</span>
          <span className="font-mono" style={{ color: "#777" }}>{msToTimestamp(step.end_ms)}</span>
          <span className="ml-auto font-mono" style={{ color: "#555" }}>
            {msToTimestamp(step.end_ms - step.start_ms)}
          </span>
        </div>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
