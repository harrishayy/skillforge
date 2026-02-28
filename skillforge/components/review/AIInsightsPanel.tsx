"use client";
import { useState } from "react";
import { useReviewStore } from "@/store/review-store";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type { Step } from "@/types";

interface AIInsightsPanelProps {
  step: Step;
}

export function AIInsightsPanel({ step }: AIInsightsPanelProps) {
  const { stepStates, regenerate } = useReviewStore();
  const [additionalContext, setAdditionalContext] = useState("");
  const ps = stepStates[step.id];

  const handleRegenerate = () => {
    regenerate(step.id, additionalContext);
    setAdditionalContext("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#666" }}>
          AI Insights
        </h3>
        {ps?.isRegenerating && (
          <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--sf-purple)" }}>
            <Spinner className="w-3 h-3" /> Regenerating...
          </span>
        )}
      </div>

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

      <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
        <label className="block text-[10px] font-bold" style={{ color: "#555" }}>
          Annotations ({step.annotations.length})
        </label>
        {step.annotations.length > 0 ? (
          <div className="space-y-1">
            {step.annotations.map((ann) => (
              <div key={ann.id} className="flex items-center gap-2 text-[11px]" style={{ color: "#888" }}>
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: ann.color }} />
                <span className="capitalize">{ann.type.replace("_", " ")}</span>
                {ann.label && <span style={{ color: "#666" }}>— {ann.label}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: "#444" }}>No annotations generated yet.</p>
        )}
      </div>

      <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
        <label className="block text-[10px] font-bold" style={{ color: "#555" }}>
          Click Targets ({step.click_targets.length})
        </label>
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

      {/* Regenerate section */}
      <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#0d0d1a", border: "1px solid var(--sf-purple)", borderColor: "rgba(122,120,255,0.3)" }}>
        <label className="block text-[10px] font-bold" style={{ color: "var(--sf-purple)" }}>
          Regenerate with context
        </label>
        <textarea
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          placeholder="Add extra context to improve AI output..."
          rows={2}
          className="w-full rounded-md px-2.5 py-2 text-xs outline-none resize-none"
          style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
        />
        <Button
          size="sm"
          onClick={handleRegenerate}
          disabled={ps?.isRegenerating}
        >
          {ps?.isRegenerating ? "Regenerating..." : "Regenerate Step"}
        </Button>
      </div>
    </div>
  );
}
