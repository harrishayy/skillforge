"use client";
import { useParams } from "next/navigation";
import { LearnView } from "@/components/player/LearnView";

export default function PreviewPage() {
  const { workflowId } = useParams<{ workflowId: string }>();

  return (
    <LearnView
      workflowId={workflowId}
      backHref={`/editor/${workflowId}`}
      backLabel="← Back to Editor"
      accentColor="var(--sf-purple)"
      badge={
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
        >
          Preview
        </span>
      }
    />
  );
}
