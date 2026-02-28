"use client";
import { useReviewStore } from "@/store/review-store";
import { FrameCanvas } from "./FrameCanvas";
import { AIInsightsPanel } from "./AIInsightsPanel";
import { SegmentationPanel } from "./SegmentationPanel";
import { RefilmBanner } from "./RefilmBanner";
import type { Step } from "@/types";

interface StepReviewCardProps {
  step: Step;
  workflowId: string;
}

export function StepReviewCard({ step, workflowId }: StepReviewCardProps) {
  const { editStepField } = useReviewStore();

  return (
    <div className="flex-1 flex flex-col gap-3 overflow-hidden p-4">
      <RefilmBanner step={step} workflowId={workflowId} />

      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Left: Frame canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          <FrameCanvas step={step} />
        </div>

        {/* Right: Step details + AI insights */}
        <div
          className="w-80 shrink-0 overflow-y-auto space-y-4 pr-1"
          style={{ scrollbarWidth: "thin" }}
        >
          {/* Editable title */}
          <div>
            <label className="block text-[10px] font-bold mb-1 uppercase tracking-wider" style={{ color: "#666" }}>
              Step {step.step_number} Title
            </label>
            <input
              type="text"
              defaultValue={step.title}
              className="w-full rounded-lg px-3 py-2 text-sm font-medium outline-none"
              style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
              onBlur={(e) => {
                if (e.target.value !== step.title) {
                  editStepField(step.id, "title", e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>

          {/* Editable description */}
          <div>
            <label className="block text-[10px] font-bold mb-1 uppercase tracking-wider" style={{ color: "#666" }}>
              Description
            </label>
            <textarea
              defaultValue={step.description ?? ""}
              rows={3}
              placeholder="Describe what happens in this step..."
              className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none leading-relaxed"
              style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
              onBlur={(e) => {
                if (e.target.value !== (step.description ?? "")) {
                  editStepField(step.id, "description", e.target.value);
                }
              }}
            />
          </div>

          <div style={{ borderTop: "1px solid #222", paddingTop: 12 }}>
            <AIInsightsPanel step={step} />
          </div>

          <div style={{ borderTop: "1px solid #222", paddingTop: 12 }}>
            <SegmentationPanel step={step} />
          </div>
        </div>
      </div>
    </div>
  );
}
