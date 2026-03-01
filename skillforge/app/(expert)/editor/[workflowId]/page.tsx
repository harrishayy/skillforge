"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getWorkflow, publishWorkflow, unpublishWorkflow } from "@/lib/api-client";
import { showErrorToast } from "@/store/toast-store";
import { useWorkflowStore } from "@/store/workflow-store";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { StepList } from "@/components/editor/StepList";
import { StepFrameViewer } from "@/components/editor/StepFrameViewer";
import { ApparatusFrameViewer } from "@/components/editor/ApparatusFrameViewer";
import { StepDetailPanel } from "@/components/editor/StepDetailPanel";
import { PipelineStatus } from "@/components/recording/PipelineStatus";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TaskTypeBadge } from "@/components/shared/TaskTypeBadge";

export default function EditorPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const { workflow, setWorkflow, selectedStepId, selectedApparatusObjectId, selectStep, regeneratingAll, regenerateAll, rebuildingMemories } = useWorkflowStore();

  const leftPanel = useResizablePanel({
    initialWidth: 240,
    minWidth: 160,
    maxWidth: 400,
    direction: "right",
  });

  const rightPanel = useResizablePanel({
    initialWidth: 320,
    minWidth: 220,
    maxWidth: 520,
    direction: "left",
  });

  const handleTogglePublish = async () => {
    if (!workflow) return;
    setIsPublishing(true);
    try {
      const updated = workflow.published
        ? await unpublishWorkflow(workflow.id)
        : await publishWorkflow(workflow.id);
      setWorkflow(updated);
    } catch (e: any) {
      showErrorToast(e);
    } finally {
      setIsPublishing(false);
    }
  };

  useEffect(() => {
    getWorkflow(workflowId)
      .then((wf) => {
        setWorkflow(wf);
        if (wf.steps.length > 0) selectStep(wf.steps[0].id);
      })
      .catch((e) => { showErrorToast(e); setError(e.message); })
      .finally(() => setIsLoading(false));
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePipelineComplete = useCallback(() => {
    getWorkflow(workflowId)
      .then((wf) => {
        setWorkflow(wf);
        if (wf.steps.length > 0 && !selectedStepId) selectStep(wf.steps[0].id);
      })
      .catch((e) => { showErrorToast(e); setError(e.message); });
  }, [workflowId, selectedStepId, setWorkflow, selectStep]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <span style={{ color: "var(--sf-purple)" }}><Spinner className="w-8 h-8" /></span>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <div className="text-center">
          <p className="mb-4" style={{ color: "var(--sf-orange)" }}>{error ?? "Workflow not found"}</p>
          <Link href="/workflows">
            <Button variant="secondary">Back to Workflows</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (workflow.status === "processing") {
    return (
      <div className="h-full flex flex-col items-center justify-center" style={{ backgroundColor: "var(--sf-black)" }}>
        <PipelineStatus workflowId={workflowId} onComplete={handlePipelineComplete} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: "var(--sf-black)" }}>
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
        {workflow.published
          ? <Badge variant="green">Published</Badge>
          : <Badge variant="zinc">Draft</Badge>
        }
        <span className="ml-auto text-xs" style={{ color: "#555" }}>
          {workflow.steps.length} steps · Click on frames to segment
        </span>
        {workflow.status === "ready" && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => regenerateAll()}
              disabled={regeneratingAll || rebuildingMemories}
              style={{
                borderColor: "var(--sf-purple)",
                color: regeneratingAll ? "#555" : "var(--sf-purple)",
              }}
            >
              {regeneratingAll ? (
                <span className="flex items-center gap-1.5">
                  <Spinner className="w-3 h-3" />
                  Regenerating...
                </span>
              ) : (
                "Re-generate"
              )}
            </Button>
            <Button
              size="sm"
              variant={workflow.published ? "secondary" : "primary"}
              onClick={handleTogglePublish}
              disabled={isPublishing || regeneratingAll}
              style={
                !workflow.published
                  ? { backgroundColor: "var(--sf-lime)", color: "var(--sf-black)", border: "1px solid var(--sf-lime)" }
                  : undefined
              }
            >
              {isPublishing ? "..." : workflow.published ? "Unpublish" : "Publish"}
            </Button>
          </>
        )}
        <Link href={`/editor/${workflow.id}/preview`}>
          <Button size="sm">Preview as Trainee →</Button>
        </Link>
      </div>

      {/* 3-column resizable layout — drag the thin borders between panels to resize */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Step list */}
        <div
          className="shrink-0 p-3 overflow-y-auto"
          style={{ width: leftPanel.width, borderRight: "1px solid #222" }}
        >
          <StepList />
        </div>

        {/* Left resize handle */}
        <ResizeHandle onMouseDown={leftPanel.handleMouseDown} />

        {/* Center: Frame viewer with SAM3 + filmstrip + video */}
        <div className="flex-1 flex flex-col overflow-hidden p-4 min-w-0">
          {selectedApparatusObjectId ? <ApparatusFrameViewer /> : <StepFrameViewer />}
        </div>

        {/* Right resize handle */}
        <ResizeHandle onMouseDown={rightPanel.handleMouseDown} />

        {/* Right: Step detail panel */}
        <div
          className="shrink-0 p-4 overflow-y-auto"
          style={{ width: rightPanel.width, borderLeft: "1px solid #222" }}
        >
          <StepDetailPanel />
        </div>
      </div>
    </div>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="shrink-0 group flex items-center justify-center"
      style={{ width: 6, cursor: "col-resize" }}
    >
      <div
        className="w-[2px] h-8 rounded-full transition-all group-hover:h-16 group-active:h-full"
        style={{ backgroundColor: "#333" }}
      />
    </div>
  );
}
