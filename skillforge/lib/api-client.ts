import { API_BASE } from "./constants";
import type {
  Workflow,
  WorkflowSummary,
  Step,
  Annotation,
  ClickTarget,
  RegenerateStepResponse,
  SegmentPointResponse,
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
    } catch (parseErr) {
      console.warn("[API] Could not parse error response body:", parseErr);
    }
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

const UPLOAD_TIMEOUT_MS = 120_000;

export async function uploadStepVideos(opts: {
  stepVideos: Blob[];
  title: string;
  initialDescription?: string;
  stepTranscripts?: string[];
  stepNotes?: string[];
  stepDurations?: number[];
  apparatusVideo?: Blob;
}): Promise<{ workflow_id: string; status: string }> {
  const totalBytes = opts.stepVideos.reduce((sum, b) => sum + b.size, 0);
  console.log(
    `[uploadStepVideos] Starting upload: ${opts.stepVideos.length} step(s), ` +
    `${(totalBytes / 1024 / 1024).toFixed(1)} MB total, title="${opts.title}"`
  );

  const formData = new FormData();
  opts.stepVideos.forEach((blob, i) => {
    console.log(`[uploadStepVideos] step_${i + 1}.webm — ${(blob.size / 1024).toFixed(0)} KB`);
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
  if (opts.stepDurations) {
    formData.append("step_durations_json", JSON.stringify(opts.stepDurations));
  }
  if (opts.apparatusVideo) {
    console.log(`[uploadStepVideos] apparatus.webm — ${(opts.apparatusVideo.size / 1024).toFixed(0)} KB`);
    formData.append("apparatus_video", opts.apparatusVideo, "apparatus.webm");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error(`[uploadStepVideos] Aborting — exceeded ${UPLOAD_TIMEOUT_MS / 1000}s timeout`);
    controller.abort();
  }, UPLOAD_TIMEOUT_MS);

  try {
    console.log(`[uploadStepVideos] POST ${API_BASE}/api/workflows/upload-steps`);
    const res = await fetch(`${API_BASE}/api/workflows/upload-steps`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`[uploadStepVideos] Server error ${res.status}:`, body);
      throw new ApiError(res.status, body.detail ?? "Upload failed");
    }
    const result = await res.json();
    console.log("[uploadStepVideos] Success:", result);
    return result;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s. ` +
        `Check your network connection or try again.`
      );
    }
    throw err;
  }
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

// ─── Rerun Pipeline ──────────────────────────────────────────────────────────

export interface RerunPipelineOptions {
  run_claude?: boolean;
  run_nemotron?: boolean;
  run_sam3?: boolean;
}

export async function rerunStepPipeline(
  stepId: string,
  options: RerunPipelineOptions = {}
): Promise<Step> {
  return apiFetch<Step>(`/api/steps/${stepId}/rerun-pipeline`, {
    method: "POST",
    body: JSON.stringify({
      run_claude: options.run_claude ?? true,
      run_nemotron: options.run_nemotron ?? true,
      run_sam3: options.run_sam3 ?? true,
    }),
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

export interface ElaborateSubtask {
  title: string;
  description?: string;
}

export async function elaborateStep(
  workflowId: string,
  stepId: string,
  userMessage?: string
): Promise<{ subtasks: ElaborateSubtask[] }> {
  return apiFetch<{ subtasks: ElaborateSubtask[] }>("/api/copilot/elaborate-step", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: workflowId,
      step_id: stepId,
      user_message: userMessage ?? null,
    }),
  });
}

export interface CheckStepSuggestResult {
  suggest_complete: boolean;
  message: string;
  hands?: { hands: Array<{ landmarks: Array<{ x: number; y: number; z?: number }> }> } | null;
  sam3_segments?: Array<{ mask_base64?: string; bbox: number[]; score: number }>;
}

export async function checkStepSuggest(
  workflowId: string,
  stepId: string,
  frameBase64: string
): Promise<CheckStepSuggestResult> {
  return apiFetch<CheckStepSuggestResult>(
    "/api/trainee/check-step-suggest",
    {
      method: "POST",
      body: JSON.stringify({
        workflow_id: workflowId,
        step_id: stepId,
        frame_base64: frameBase64,
      }),
    }
  );
}

// ─── Voice intent (LLM fallback) ────────────────────────────────────────────

export type VoiceIntentResult = "next" | "prev" | "finish" | "elaborate" | "none";

export async function classifyVoiceIntent(transcript: string): Promise<VoiceIntentResult> {
  const data = await apiFetch<{ intent: VoiceIntentResult }>("/api/voice/intent", {
    method: "POST",
    body: JSON.stringify({ transcript }),
  });
  return data.intent;
}

// ─── ASR (server-side transcription via Brev-hosted Parakeet) ───────────────

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "chunk.webm");

  const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? "Transcription failed");
  }
  const data: { transcript: string } = await res.json();
  return data.transcript ?? "";
}

export { ApiError };
