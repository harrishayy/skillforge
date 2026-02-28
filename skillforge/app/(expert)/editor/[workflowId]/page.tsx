"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getWorkflow } from "@/lib/api-client";
import { useWorkflowStore } from "@/store/workflow-store";
import { StepList } from "@/components/editor/StepList";
import { FabricCanvas } from "@/components/editor/FabricCanvas";
import { AnnotationToolbar } from "@/components/editor/AnnotationToolbar";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { TaskTypeBadge } from "@/components/shared/TaskTypeBadge";

export default function EditorPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { workflow, setWorkflow, selectedStepId, selectStep } = useWorkflowStore();

  useEffect(() => {
    getWorkflow(workflowId)
      .then((wf) => {
        setWorkflow(wf);
        if (wf.steps.length > 0) selectStep(wf.steps[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <span style={{ color: "var(--sf-purple)" }}><Spinner className="w-8 h-8" /></span>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <div className="text-center">
          <p className="mb-4" style={{ color: "var(--sf-orange)" }}>{error ?? "Workflow not found"}</p>
          <Link href="/workflows">
            <Button variant="secondary">Back to Workflows</Button>
          </Link>
        </div>
      </div>
    );
  }

  const selectedStep = workflow.steps.find((s) => s.id === selectedStepId);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "var(--sf-black)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-4 px-6 py-3 shrink-0"
        style={{ borderBottom: "1px solid #222" }}
      >
        <Link href="/workflows" className="text-sm font-medium transition-colors" style={{ color: "#777" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--sf-purple)")}
          onMouseLeave={e => (e.currentTarget.style.color = "#777")}
        >
          ← Workflows
        </Link>
        <h1 className="text-sm font-bold" style={{ color: "var(--sf-white)" }}>{workflow.title}</h1>
        <TaskTypeBadge />
        <span className="ml-auto text-xs" style={{ color: "#555" }}>
          {workflow.steps.length} steps · Double-click step titles to rename
        </span>
        <Link href={`/learn/${workflow.id}`}>
          <Button size="sm">Preview as Trainee →</Button>
        </Link>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Step list */}
        <div className="w-60 shrink-0 p-3 overflow-y-auto" style={{ borderRight: "1px solid #222" }}>
          <StepList />
        </div>

        {/* Center: Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
          <AnnotationToolbar />
          <div className="flex-1 overflow-auto flex items-center justify-center">
            {selectedStep ? (
              <FabricCanvas />
            ) : (
              <div className="text-sm" style={{ color: "#444" }}>Select a step to annotate</div>
            )}
          </div>
        </div>

        {/* Right: Step detail */}
        <div className="w-72 shrink-0 p-4 overflow-y-auto" style={{ borderLeft: "1px solid #222" }}>
          {selectedStep ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Step Title</label>
                <p className="text-sm font-medium" style={{ color: "var(--sf-white)" }}>{selectedStep.title}</p>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Description</label>
                <textarea
                  defaultValue={selectedStep.description ?? ""}
                  rows={4}
                  placeholder="Add instructions for the trainee..."
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                  style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
                  onBlur={async (e) => {
                    const { saveStep } = useWorkflowStore.getState();
                    await saveStep(selectedStep.id, { description: e.target.value });
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Annotations</label>
                <div className="space-y-1">
                  {selectedStep.annotations.map((ann) => (
                    <div key={ann.id} className="flex items-center gap-2 text-xs py-1" style={{ color: "#888" }}>
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: ann.color }} />
                      <span className="capitalize">{ann.type.replace("_", " ")}</span>
                      {ann.label && <span style={{ color: "#666" }}>— {ann.label}</span>}
                    </div>
                  ))}
                  {selectedStep.annotations.length === 0 && (
                    <p className="text-xs" style={{ color: "#444" }}>No annotations yet. Use the toolbar to add some.</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Click Targets</label>
                <div className="space-y-1">
                  {selectedStep.click_targets.map((ct) => (
                    <div key={ct.id} className="flex items-center gap-2 text-xs py-1">
                      <span style={{ color: ct.is_primary ? "var(--sf-lime)" : "#555" }}>
                        {ct.is_primary ? "★" : "○"}
                      </span>
                      <span style={{ color: "#888" }}>
                        {ct.element_text ?? ct.element_type ?? "element"}
                      </span>
                    </div>
                  ))}
                  {selectedStep.click_targets.length === 0 && (
                    <p className="text-xs" style={{ color: "#444" }}>No click targets detected for this step.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "#444" }}>Select a step from the left panel</p>
          )}
        </div>
      </div>
    </div>
  );
}
