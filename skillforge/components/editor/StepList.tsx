"use client";
import { useState, useMemo } from "react";
import { useWorkflowStore } from "@/store/workflow-store";
import { StepCard } from "./StepCard";
import { Spinner } from "@/components/ui/Spinner";
import { frameUrl } from "@/lib/constants";
import type { ApparatusObject } from "@/types";

function extractKeywords(text: string): Set<string> {
  const stopwords = new Set([
    "the", "a", "an", "to", "and", "or", "of", "in", "on", "at", "is",
    "it", "for", "this", "that", "with", "from", "by", "as", "be", "are",
    "was", "were", "do", "does", "how", "use", "using", "step",
  ]);
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !stopwords.has(w))
  );
}

function isRelevantObject(obj: ApparatusObject, keywords: Set<string>): boolean {
  if (keywords.size === 0) return false;
  const objText = `${obj.object_name} ${obj.visual_cues} ${obj.description ?? ""} ${obj.object_type}`.toLowerCase();
  for (const kw of keywords) {
    if (objText.includes(kw)) return true;
  }
  return false;
}

function ObjectThumbnail({ obj }: { obj: ApparatusObject }) {
  const src = obj.segmented_reference_path
    ? frameUrl(obj.segmented_reference_path)
    : obj.reference_frame_paths?.[0]
      ? frameUrl(obj.reference_frame_paths[0])
      : null;

  return (
    <div
      className="shrink-0 rounded overflow-hidden"
      style={{ width: 48, height: 32, backgroundColor: "#1a1a1a", border: "1px solid #333" }}
    >
      {src ? (
        <img src={src} alt={obj.object_name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[9px]" style={{ color: "#555" }}>?</div>
      )}
    </div>
  );
}

export function StepList() {
  const {
    workflow,
    selectedStepId,
    selectedApparatusObjectId,
    selectStep,
    selectApparatusObject,
    rebuildingMemories,
    rebuildMemories,
  } = useWorkflowStore();

  const apparatusObjects = workflow?.apparatus_objects ?? [];
  const hasApparatus = apparatusObjects.length > 0;

  const keywords = useMemo(() => {
    if (!workflow) return new Set<string>();
    return extractKeywords(`${workflow.title} ${workflow.description ?? ""}`);
  }, [workflow?.title, workflow?.description]);

  const { relevant, other } = useMemo(() => {
    const rel: ApparatusObject[] = [];
    const oth: ApparatusObject[] = [];
    for (const obj of apparatusObjects) {
      if (isRelevantObject(obj, keywords)) rel.push(obj);
      else oth.push(obj);
    }
    return { relevant: rel, other: oth };
  }, [apparatusObjects, keywords]);

  const [showAllObjects, setShowAllObjects] = useState(false);

  if (!workflow) return null;

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {/* Apparatus section — two-tier: Relevant / All */}
      {hasApparatus && (
        <>
          {/* RELEVANT OBJECTS (always visible if any) */}
          {relevant.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--sf-lime)" }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--sf-lime)" }}>
                  Relevant ({relevant.length})
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {relevant.map((obj) => (
                  <button
                    key={obj.id}
                    onClick={() => selectApparatusObject(obj.id)}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg transition-all text-left"
                    style={{
                      backgroundColor: selectedApparatusObjectId === obj.id ? "rgba(190,242,100,0.12)" : "#0d0d0d",
                      border: selectedApparatusObjectId === obj.id
                        ? "1px solid rgba(190,242,100,0.3)"
                        : "1px solid #222",
                      cursor: "pointer",
                    }}
                  >
                    <ObjectThumbnail obj={obj} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: "var(--sf-white)" }}>
                        {obj.object_name}
                      </div>
                      <div className="text-[10px] truncate" style={{ color: "#666" }}>
                        {obj.object_type} · {obj.angle_count} angles
                      </div>
                    </div>
                    {obj.segmented_reference_path && (
                      <span
                        className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: "rgba(190,242,100,0.15)", color: "var(--sf-lime)" }}
                      >
                        SAM3
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ALL OBJECTS (collapsible) */}
          {other.length > 0 && (
            <div>
              <button
                onClick={() => setShowAllObjects((v) => !v)}
                className="flex items-center gap-1.5 mb-1.5 transition-colors"
                style={{ color: "#666" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#aaa")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
              >
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: showAllObjects ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  All Objects ({other.length})
                </span>
              </button>
              {showAllObjects && (
                <div className="flex flex-col gap-1.5">
                  {other.map((obj) => (
                    <button
                      key={obj.id}
                      onClick={() => selectApparatusObject(obj.id)}
                      className="w-full flex items-center gap-2.5 p-2 rounded-lg transition-all text-left"
                      style={{
                        backgroundColor: selectedApparatusObjectId === obj.id ? "rgba(190,242,100,0.12)" : "#0d0d0d",
                        border: selectedApparatusObjectId === obj.id
                          ? "1px solid rgba(190,242,100,0.3)"
                          : "1px solid #222",
                        cursor: "pointer",
                      }}
                    >
                      <ObjectThumbnail obj={obj} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: "var(--sf-white)" }}>
                          {obj.object_name}
                        </div>
                        <div className="text-[10px] truncate" style={{ color: "#666" }}>
                          {obj.object_type} · {obj.angle_count} angles
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rebuild Memories button */}
          <button
            onClick={() => rebuildMemories()}
            disabled={rebuildingMemories}
            className="flex items-center justify-center gap-2 w-full text-[11px] font-medium py-1.5 px-3 rounded-md transition-all"
            style={{
              backgroundColor: "#1a1a1a",
              color: rebuildingMemories ? "#555" : "var(--sf-purple)",
              border: `1px solid ${rebuildingMemories ? "#222" : "#333"}`,
              cursor: rebuildingMemories ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!rebuildingMemories) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#222";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--sf-purple)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
              (e.currentTarget as HTMLButtonElement).style.borderColor = rebuildingMemories ? "#222" : "#333";
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
