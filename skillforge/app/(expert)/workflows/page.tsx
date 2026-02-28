"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { WorkflowSummary } from "@/types";
import { listWorkflows, deleteWorkflow } from "@/lib/api-client";
import { WorkflowCard } from "@/components/shared/WorkflowCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export default function ExpertWorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    listWorkflows()
      .then(setWorkflows)
      .finally(() => setIsLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this workflow?")) return;
    await deleteWorkflow(id);
    setWorkflows((wfs) => wfs.filter((w) => w.id !== id));
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="font-black"
            style={{ fontSize: "2rem", letterSpacing: "-0.04em", color: "var(--sf-black)" }}
          >
            My Workflows
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--sf-gray)" }}>Recordings you have created</p>
        </div>
        <Link href="/record">
          <Button>+ New Recording</Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <span style={{ color: "var(--sf-purple)" }}><Spinner className="w-8 h-8" /></span>
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">🎬</p>
          <p className="font-bold text-lg mb-1" style={{ color: "var(--sf-black)" }}>No workflows yet</p>
          <p className="text-sm mt-1 mb-6" style={{ color: "var(--sf-gray)" }}>
            Record yourself completing a task to get started
          </p>
          <Link href="/record">
            <Button>Create Your First Workflow</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {workflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              href={`/editor/${wf.id}`}
              actions={
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete(wf.id);
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-opacity hover:opacity-80"
                  style={{ backgroundColor: "var(--sf-orange)", color: "var(--sf-black)" }}
                >
                  ×
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
