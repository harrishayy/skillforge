"use client";
import Link from "next/link";
import type { WorkflowSummary } from "@/types";
import { TaskTypeBadge } from "./TaskTypeBadge";
import { Badge } from "@/components/ui/Badge";
import { frameUrl } from "@/lib/constants";
import { msToTimestamp } from "@/lib/video-utils";

interface WorkflowCardProps {
  workflow: WorkflowSummary;
  href: string;
  actions?: React.ReactNode;
}

export function WorkflowCard({ workflow, href, actions }: WorkflowCardProps) {
  return (
    <div
      className="group relative rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg"
      style={{ backgroundColor: "var(--sf-white)", border: "1px solid var(--sf-black)" }}
    >
      <Link href={href}>
        {/* Thumbnail */}
        <div className="aspect-video overflow-hidden" style={{ backgroundColor: "var(--sf-light-gray)" }}>
          {workflow.thumbnail_path ? (
            <img
              src={frameUrl(workflow.thumbnail_path)}
              alt={workflow.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ color: "#bbb" }}>
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3
              className="text-sm font-bold line-clamp-2"
              style={{ color: "var(--sf-black)", letterSpacing: "-0.01em" }}
            >
              {workflow.title}
            </h3>
            <TaskTypeBadge />
          </div>

          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--sf-gray)" }}>
            <span>{workflow.total_steps} steps</span>
            {workflow.duration_ms && (
              <span>{msToTimestamp(workflow.duration_ms)}</span>
            )}
            {workflow.status === "processing" && (
              <Badge variant="amber">Processing...</Badge>
            )}
            {workflow.status === "failed" && (
              <Badge variant="red">Failed</Badge>
            )}
          </div>
        </div>
      </Link>

      {actions && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
}
