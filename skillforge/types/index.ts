// ─── Enums ────────────────────────────────────────────────────────────────────

export type TaskMode = "hardware";
export type WorkflowStatus = "processing" | "ready" | "failed";
export type AnnotationType = "bounding_box" | "arrow" | "highlight" | "text_label";
export type InputEventType = "click" | "keypress" | "scroll" | "drag";
export type PipelineStage =
  | "frame_extraction"
  | "nemotron_vl"
  | "yolo"
  | "mediapipe"
  | "claude_decompose"
  | "complete"
  | "error";

// ─── Domain Models ────────────────────────────────────────────────────────────

export interface Annotation {
  id: string;
  step_id: string;
  type: AnnotationType;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  from_x?: number;
  from_y?: number;
  to_x?: number;
  to_y?: number;
  color: string;
  style: "solid" | "dashed" | "pulse";
  created_at: number;
}

export interface ClickTarget {
  id: string;
  step_id: string;
  element_text?: string;
  element_type?: string;
  bbox_x: number;
  bbox_y: number;
  bbox_width: number;
  bbox_height: number;
  action: string;
  confidence?: number;
  is_primary: boolean;
}

export interface StepFrame {
  id: string;
  step_id: string;
  timestamp_ms: number;
  frame_path: string;
  is_key_frame: boolean;
}

export interface Step {
  id: string;
  workflow_id: string;
  step_number: number;
  title: string;
  description?: string;
  start_ms: number;
  end_ms: number;
  key_frame_path?: string;
  video_path?: string;
  ai_description?: string;
  annotations: Annotation[];
  click_targets: ClickTarget[];
  frames: StepFrame[];
  created_at: number;
  updated_at: number;
}

export interface Workflow {
  id: string;
  title: string;
  description?: string;
  mode: TaskMode;
  status: WorkflowStatus;
  published: boolean;
  video_path?: string;
  duration_ms?: number;
  total_steps: number;
  thumbnail_path?: string;
  steps: Step[];
  created_at: number;
  updated_at: number;
}

export interface WorkflowSummary {
  id: string;
  title: string;
  description?: string;
  mode: TaskMode;
  status: WorkflowStatus;
  published: boolean;
  total_steps: number;
  duration_ms?: number;
  thumbnail_path?: string;
  created_at: number;
}

// ─── Pipeline / WebSocket Events ──────────────────────────────────────────────

export interface PipelineLogEvent {
  type: "pipeline_log";
  stage: PipelineStage;
  message: string;
  progress: number;
  timestamp: number;
}

export interface StepCreatedEvent {
  type: "step_created";
  step: Step;
}

export interface PipelineCompleteEvent {
  type: "complete";
  workflow_id: string;
  total_steps: number;
}

export interface PipelineErrorEvent {
  type: "error";
  stage: PipelineStage;
  message: string;
  recoverable: boolean;
}

export type PipelineEvent =
  | PipelineLogEvent
  | StepCreatedEvent
  | PipelineCompleteEvent
  | PipelineErrorEvent;

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ─── Recording ────────────────────────────────────────────────────────────────

export interface RecordedInputEvent {
  event_type: InputEventType;
  timestamp_ms: number;
  x?: number;
  y?: number;
  key?: string;
  button?: string;
  scroll_delta?: number;
  element_selector?: string;
  element_text?: string;
}

export interface RecordingSession {
  mode: TaskMode;
  startTime: number;
  blob: Blob | null;
  inputEvents: RecordedInputEvent[];
  duration_ms: number;
}

// ─── Segmentation ────────────────────────────────────────────────────────────

export interface Sam3Segment {
  mask_base64: string;
  bbox: [number, number, number, number];
  score: number;
}

export interface SegmentPointResponse {
  segments: Sam3Segment[];
  frame_path: string;
}

export interface RegenerateStepResponse {
  step: Step;
}

// ─── Player State ─────────────────────────────────────────────────────────────

export interface PlayerState {
  currentStepIndex: number;
  isPlaying: boolean;
  currentTimeMs: number;
  isPausedAtStepEnd: boolean;
  chatHistory: ChatMessage[];
  isCopilotLoading: boolean;
  currentInstruction: string;
}
