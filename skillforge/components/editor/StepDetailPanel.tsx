"use client";
import { useState } from "react";
import { useWorkflowStore, selectedStep } from "@/store/workflow-store";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export function StepDetailPanel() {
  const store = useWorkflowStore();
  const step = selectedStep(store);
  const {
    segmentsByStep,
    segmentingStepId,
    regeneratingStepId,
    saveStep,
    removeSegment,
    clearSegments,
    regenerate,
  } = store;

  const [additionalContext, setAdditionalContext] = useState("");

  if (!step) {
    return (
      <p className="text-sm" style={{ color: "#444" }}>Select a step from the left panel</p>
    );
  }

  const segments = segmentsByStep[step.id] ?? [];
  const isSegmenting = segmentingStepId === step.id;
  const isRegenerating = regeneratingStepId === step.id;

  const handleRegenerate = () => {
    regenerate(step.id, additionalContext);
    setAdditionalContext("");
  };

  return (
    <div className="space-y-4">
      {/* Step info */}
      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Step Title</label>
        <p className="text-sm font-medium" style={{ color: "var(--sf-white)" }}>{step.title}</p>
      </div>
      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Description</label>
        <textarea
          defaultValue={step.description ?? ""}
          key={step.id}
          rows={3}
          placeholder="Add instructions for the trainee..."
          className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
          onBlur={async (e) => {
            await saveStep(step.id, { description: e.target.value });
          }}
        />
      </div>

      {/* AI description */}
      {step.ai_description && (
        <div className="rounded-lg p-3" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
          <label className="block text-[10px] font-bold mb-1" style={{ color: "#555" }}>
            AI Description
          </label>
          <p className="text-xs leading-relaxed" style={{ color: "#aaa" }}>
            {step.ai_description}
          </p>
        </div>
      )}

      {/* SAM3 Segments */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#666" }}>
            SAM3 Segments ({segments.length})
            {isSegmenting && (
              <span className="ml-2 normal-case tracking-normal" style={{ color: "var(--sf-yellow)" }}>
                <Spinner className="w-3 h-3 inline" /> Segmenting...
              </span>
            )}
          </h3>
          {segments.length > 0 && (
            <button
              onClick={() => clearSegments(step.id)}
              className="text-[10px] font-medium transition-colors"
              style={{ color: "var(--sf-orange)" }}
            >
              Clear all
            </button>
          )}
        </div>

        {segments.length > 0 ? (
          <div className="space-y-1.5">
            {segments.map((seg, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ backgroundColor: "#111", border: "1px solid #222" }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: "var(--sf-yellow)" }} />
                  <span className="text-[11px]" style={{ color: "#888" }}>Segment {i + 1}</span>
                  <span className="text-[10px]" style={{ color: "#555" }}>
                    {(seg.score * 100).toFixed(0)}% conf
                  </span>
                </div>
                <button
                  onClick={() => removeSegment(step.id, i)}
                  className="text-[10px] font-medium transition-colors"
                  style={{ color: "#555" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sf-orange)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: "#111", border: "1px dashed #333" }}>
            <p className="text-[11px]" style={{ color: "#555" }}>No segments added yet</p>
            <p className="text-[10px]" style={{ color: "#444" }}>Click on the frame to add a SAM3 segmentation</p>
          </div>
        )}
      </div>

      {/* Click targets */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#666" }}>
          Click Targets ({step.click_targets.length})
        </h3>
        {step.click_targets.length > 0 ? (
          <div className="space-y-1">
            {step.click_targets.map((ct) => (
              <div key={ct.id} className="flex items-center gap-2 text-[11px]">
                <span style={{ color: ct.is_primary ? "var(--sf-lime)" : "#555" }}>
                  {ct.is_primary ? "★" : "○"}
                </span>
                <span style={{ color: "#888" }}>
                  {ct.element_text ?? ct.element_type ?? "element"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: "#444" }}>No click targets detected.</p>
        )}
      </div>

      {/* Regenerate */}
      <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#0d0d1a", border: "1px solid rgba(122,120,255,0.3)" }}>
        <label className="block text-[10px] font-bold" style={{ color: "var(--sf-purple)" }}>
          Regenerate with context
          {isRegenerating && (
            <span className="ml-2 font-normal" style={{ color: "var(--sf-purple)" }}>
              <Spinner className="w-3 h-3 inline" /> Regenerating...
            </span>
          )}
        </label>
        <textarea
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          placeholder="Add extra context to improve AI output..."
          rows={2}
          className="w-full rounded-md px-2.5 py-2 text-xs outline-none resize-none"
          style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
        />
        <Button size="sm" onClick={handleRegenerate} disabled={isRegenerating}>
          {isRegenerating ? "Regenerating..." : "Regenerate Step"}
        </Button>
      </div>
    </div>
  );
}
