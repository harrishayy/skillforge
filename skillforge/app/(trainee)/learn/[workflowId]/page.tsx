"use client";
import { useParams } from "next/navigation";
import { LearnView } from "@/components/player/LearnView";

export default function LearnPage() {
  const { workflowId } = useParams<{ workflowId: string }>();

  return (
    <LearnView
      workflowId={workflowId}
      backHref="/library"
      backLabel="← Library"
    />
  );
}
