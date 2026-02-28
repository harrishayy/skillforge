"use client";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useReviewStore } from "@/store/review-store";
import { ReviewShell } from "@/components/review/ReviewShell";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

export default function ReviewPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { loadWorkflow, isLoading, error, workflow } = useReviewStore();

  useEffect(() => {
    loadWorkflow(workflowId);
  }, [workflowId, loadWorkflow]);

  if (isLoading) {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ backgroundColor: "var(--sf-black)" }}
      >
        <div className="flex flex-col items-center gap-3">
          <span style={{ color: "var(--sf-purple)" }}>
            <Spinner className="w-8 h-8" />
          </span>
          <p className="text-sm" style={{ color: "#888" }}>
            Loading workflow for review...
          </p>
        </div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ backgroundColor: "var(--sf-black)" }}
      >
        <div className="text-center space-y-3">
          <p className="text-sm" style={{ color: "var(--sf-orange)" }}>
            {error ?? "Workflow not found"}
          </p>
          <Link href="/workflows">
            <Button variant="secondary">Back to Workflows</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <ReviewShell workflowId={workflowId} />;
}
