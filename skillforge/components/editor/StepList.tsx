"use client";
import { useState } from "react";
import { useWorkflowStore } from "@/store/workflow-store";
import { StepCard } from "./StepCard";
import { ApparatusObjectCard } from "./ApparatusObjectCard";
import { Spinner } from "@/components/ui/Spinner";

export function StepList() {
  const { workflow, selectedStepId, selectStep, rebuildingMemories, rebuildMemories } =
    useWorkflowStore();

  const apparatusObjects = workflow?.apparatus_objects ?? [];
  const hasApparatus = apparatusObjects.length > 0;
  const [apparatusOpen, setApparatusOpen] = useState(hasApparatus);

  if (!workflow) return null;

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {/* Apparatus section */}
      {hasApparatus && (
        <>
          <button
            onClick={() => setApparatusOpen((o) => !o)}
            className="flex items-center justify-between mb-0 w-full text-left"
          >
            <h3
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: "#555" }}
            >
              Apparatus ({apparatusObjects.length})
            </h3>
            <span
              className="text-xs transition-transform"
              style={{
                color: "#555",
                transform: apparatusOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▶
            </span>
          </button>

          {apparatusOpen && (
            <div className="flex flex-col gap-1.5">
              {apparatusObjects.map((obj) => (
                <ApparatusObjectCard key={obj.id} object={obj} />
              ))}

              {/* Rebuild Memories button */}
              <button
                onClick={() => rebuildMemories()}
                disabled={rebuildingMemories}
                className="mt-1 flex items-center justify-center gap-2 w-full text-[11px] font-medium py-1.5 px-3 rounded-md transition-all"
                style={{
                  backgroundColor: rebuildingMemories ? "#1a1a1a" : "#1a1a1a",
                  color: rebuildingMemories ? "#555" : "var(--sf-purple)",
                  border: `1px solid ${rebuildingMemories ? "#222" : "#333"}`,
                  cursor: rebuildingMemories ? "not-allowed" : "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!rebuildingMemories) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#222";
                    (e.currentTarget as HTMLButtonElement).style.borderColor =
                      "var(--sf-purple)";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = rebuildingMemories
                    ? "#222"
                    : "#333";
                }}
                title="Invalidate all step contexts and re-run the multi-agent pipeline with updated apparatus descriptions"
              >
                {rebuildingMemories ? (
                  <>
                    <Spinner className="w-3 h-3" />
                    Rebuilding...
                  </>
                ) : (
                  "Rebuild Memories"
                )}
              </button>
            </div>
          )}

          {/* Divider */}
          <div style={{ borderBottom: "1px solid #222", margin: "4px 0" }} />
        </>
      )}

      {/* Steps section */}
      <div className="flex items-center justify-between mb-2">
        <h3
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: "#555" }}
        >
          Steps ({workflow.steps.length})
        </h3>
      </div>
      {workflow.steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          isSelected={selectedStepId === step.id}
          onSelect={() => selectStep(step.id)}
        />
      ))}
    </div>
  );
}
