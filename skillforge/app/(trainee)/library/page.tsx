"use client";
import { useEffect, useState } from "react";
import type { WorkflowSummary } from "@/types";
import { listWorkflows } from "@/lib/api-client";
import { WorkflowCard } from "@/components/shared/WorkflowCard";
import { Spinner } from "@/components/ui/Spinner";

export default function LibraryPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    listWorkflows()
      .then((all) => setWorkflows(all.filter((w) => w.status === "ready")))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1
          className="font-black"
          style={{ fontSize: "2rem", letterSpacing: "-0.04em", color: "var(--sf-black)" }}
        >
          Skill Library
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--sf-gray)" }}>Browse and start learning</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <span style={{ color: "var(--sf-lime)" }}><Spinner className="w-8 h-8" /></span>
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">📚</p>
          <p className="font-bold text-lg mb-1" style={{ color: "var(--sf-black)" }}>No workflows available yet</p>
          <p className="text-sm" style={{ color: "var(--sf-gray)" }}>
            Check back once an expert has created some workflows
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {workflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              href={`/learn/${wf.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
