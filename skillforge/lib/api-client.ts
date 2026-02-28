import { API_BASE } from "./constants";
import type {
  Workflow,
  WorkflowSummary,
  Step,
  Annotation,
  ClickTarget,
  RegenerateStepResponse,
  SegmentPointResponse,
  SubtitleSegment,
} from "@/types";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.error ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }

  return res.json();
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export async function listWorkflows(
  opts?: { publishedOnly?: boolean }
): Promise<WorkflowSummary[]> {
  const qs = opts?.publishedOnly ? "?published_only=true" : "";
  const data = await apiFetch<{ workflows: WorkflowSummary[] }>(`/api/workflows${qs}`);
  return data.workflows;
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/workflows/${id}`);
}

export async function updateWorkflow(
  id: string,
  body: { title?: string; description?: string }
): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/workflows/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  await apiFetch(`/api/workflows/${id}`, { method: "DELETE" });
}

export async function publishWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/workflows/${id}/publish`, { method: "POST" });
}

export async function unpublishWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/workflows/${id}/unpublish`, { method: "POST" });
}

export async function uploadRecording(formData: FormData): Promise<{
  workflow_id: string;
  status: string;
}> {
  const res = await fetch(`${API_BASE}/api/workflows/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? "Upload failed");
  }
  return res.json();
}

export async function uploadStepVideos(opts: {
  stepVideos: Blob[];
  title: string;
  initialDescription?: string;
  stepTranscripts?: string[];
  stepNotes?: string[];
}): Promise<{ workflow_id: string; status: string }> {
  const formData = new FormData();
  opts.stepVideos.forEach((blob, i) => {
    formData.append("step_videos", blob, `step_${i + 1}.webm`);
  });
  formData.append("title", opts.title);
  if (opts.initialDescription) {
    formData.append("initial_description", opts.initialDescription);
  }
  if (opts.stepTranscripts) {
    formData.append("step_transcripts_json", JSON.stringify(opts.stepTranscripts));
  }
  if (opts.stepNotes) {
    formData.append("step_notes_json", JSON.stringify(opts.stepNotes));
  }

  const res = await fetch(`${API_BASE}/api/workflows/upload-steps`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? "Upload failed");
  }
  return res.json();
}

export async function getGuidedStepPrompt(
  initialDescription: string,
  stepNumber: number,
  previousTranscripts: string[]
): Promise<string> {
  const data = await apiFetch<{ prompt: string }>("/api/guided/step-prompt", {
    method: "POST",
    body: JSON.stringify({
      initial_description: initialDescription,
      step_number: stepNumber,
      previous_transcripts: previousTranscripts,
    }),
  });
  return data.prompt;
}

// ─── Steps ────────────────────────────────────────────────────────────────────

export async function updateStep(
  stepId: string,
  body: Partial<Pick<Step, "title" | "description" | "step_number" | "start_ms" | "end_ms">>
): Promise<Step> {
  return apiFetch<Step>(`/api/steps/${stepId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteStep(stepId: string): Promise<void> {
  await apiFetch(`/api/steps/${stepId}`, { method: "DELETE" });
}

// ─── Annotations ──────────────────────────────────────────────────────────────

export async function createAnnotation(
  stepId: string,
  body: Omit<Annotation, "id" | "step_id" | "created_at">
): Promise<Annotation> {
  return apiFetch<Annotation>(`/api/steps/${stepId}/annotations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAnnotation(
  annotationId: string,
  body: Omit<Annotation, "id" | "step_id" | "created_at">
): Promise<Annotation> {
  return apiFetch<Annotation>(`/api/annotations/${annotationId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteAnnotation(annotationId: string): Promise<void> {
  await apiFetch(`/api/annotations/${annotationId}`, { method: "DELETE" });
}

// ─── Click Targets ────────────────────────────────────────────────────────────

export async function createClickTarget(
  stepId: string,
  body: Omit<ClickTarget, "id" | "step_id" | "confidence">
): Promise<ClickTarget> {
  return apiFetch<ClickTarget>(`/api/steps/${stepId}/click-targets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteClickTarget(targetId: string): Promise<void> {
  await apiFetch(`/api/click-targets/${targetId}`, { method: "DELETE" });
}

// ─── Regenerate & Segment ────────────────────────────────────────────────────

export async function regenerateStep(
  stepId: string,
  additionalContext?: string
): Promise<RegenerateStepResponse> {
  return apiFetch<RegenerateStepResponse>(`/api/steps/${stepId}/regenerate`, {
    method: "POST",
    body: JSON.stringify({ additional_context: additionalContext ?? "" }),
  });
}

export async function segmentPoint(
  stepId: string,
  x: number,
  y: number,
  frameTimestampMs: number
): Promise<SegmentPointResponse> {
  return apiFetch<SegmentPointResponse>(`/api/steps/${stepId}/segment-point`, {
    method: "POST",
    body: JSON.stringify({ x, y, frame_timestamp_ms: frameTimestampMs }),
  });
}

// ─── Copilot ──────────────────────────────────────────────────────────────────

export async function getStepInstruction(
  workflowId: string,
  stepId: string
): Promise<string> {
  const data = await apiFetch<{ instruction: string }>("/api/copilot/step-instruction", {
    method: "POST",
    body: JSON.stringify({ workflow_id: workflowId, step_id: stepId }),
  });
  return data.instruction;
}

// ─── Voice intent (LLM fallback) ────────────────────────────────────────────

export type VoiceIntentResult = "next" | "prev" | "finish" | "none";

export async function classifyVoiceIntent(transcript: string): Promise<VoiceIntentResult> {
  const data = await apiFetch<{ intent: VoiceIntentResult }>("/api/voice/intent", {
    method: "POST",
    body: JSON.stringify({ transcript }),
  });
  return data.intent;
}

// ─── Subtitles ────────────────────────────────────────────────────────────────

export async function getStepSubtitles(stepId: string): Promise<SubtitleSegment[]> {
  const data = await apiFetch<{ subtitles: SubtitleSegment[] }>(`/api/steps/${stepId}/subtitles`);
  return data.subtitles;
}

export { ApiError };
