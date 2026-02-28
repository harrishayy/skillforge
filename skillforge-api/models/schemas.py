from pydantic import BaseModel, Field
from typing import Literal, Optional
from enum import Enum


class TaskMode(str, Enum):
    hardware = "hardware"


class WorkflowStatus(str, Enum):
    processing = "processing"
    ready = "ready"
    failed = "failed"


class AnnotationType(str, Enum):
    bounding_box = "bounding_box"
    arrow = "arrow"
    highlight = "highlight"
    text_label = "text_label"


# ─── Request Bodies ───────────────────────────────────────────────────────────

class WorkflowUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    published: Optional[bool] = None


class StepCreateRequest(BaseModel):
    step_number: int
    title: str
    description: Optional[str] = None
    start_ms: int
    end_ms: int
    key_frame_path: Optional[str] = None


class StepUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    note: Optional[str] = None
    step_number: Optional[int] = None
    start_ms: Optional[int] = None
    end_ms: Optional[int] = None


class AnnotationCreateRequest(BaseModel):
    type: AnnotationType
    label: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    from_x: Optional[float] = None
    from_y: Optional[float] = None
    to_x: Optional[float] = None
    to_y: Optional[float] = None
    color: str = "#3B82F6"
    style: str = "solid"


class ClickTargetCreateRequest(BaseModel):
    element_text: Optional[str] = None
    element_type: Optional[str] = None
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float
    action: str = "left_click"
    is_primary: bool = False


class RegenerateStepRequest(BaseModel):
    additional_context: str = ""


class SegmentPointRequest(BaseModel):
    x: float = Field(..., ge=0, le=1, description="Normalized x coordinate (0-1)")
    y: float = Field(..., ge=0, le=1, description="Normalized y coordinate (0-1)")
    frame_timestamp_ms: int
    mode: Literal["add", "remove"] = "add"
    existing_segments: list[dict] = Field(default_factory=list)


class CopilotChatRequest(BaseModel):
    workflow_id: str
    step_id: str
    message: str
    chat_history: list[dict] = Field(default_factory=list)


class StepInstructionRequest(BaseModel):
    workflow_id: str
    step_id: str


class VoiceIntentRequest(BaseModel):
    transcript: str


# ─── Response Models ──────────────────────────────────────────────────────────

class AnnotationResponse(BaseModel):
    id: str
    step_id: str
    type: str
    label: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    from_x: Optional[float] = None
    from_y: Optional[float] = None
    to_x: Optional[float] = None
    to_y: Optional[float] = None
    color: str
    style: str
    created_at: int


class ClickTargetResponse(BaseModel):
    id: str
    step_id: str
    element_text: Optional[str] = None
    element_type: Optional[str] = None
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float
    action: str
    confidence: Optional[float] = None
    is_primary: bool


class StepFrameResponse(BaseModel):
    id: str
    step_id: str
    timestamp_ms: int
    frame_path: str
    is_key_frame: bool
    object_detected: bool = False
    object_description: Optional[str] = None


class StepResponse(BaseModel):
    id: str
    workflow_id: str
    step_number: int
    title: str
    description: Optional[str] = None
    start_ms: int
    end_ms: int
    key_frame_path: Optional[str] = None
    video_path: Optional[str] = None
    ai_description: Optional[str] = None
    transcript: Optional[str] = None
    note: Optional[str] = None
    sam3_prompt: Optional[str] = None
    annotations: list[AnnotationResponse] = []
    click_targets: list[ClickTargetResponse] = []
    frames: list[StepFrameResponse] = []
    created_at: int
    updated_at: int


class WorkflowSummaryResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    mode: str
    status: str
    total_steps: int
    published: bool = False
    duration_ms: Optional[int] = None
    thumbnail_path: Optional[str] = None
    created_at: int


class WorkflowDetailResponse(WorkflowSummaryResponse):
    video_path: Optional[str] = None
    steps: list[StepResponse] = []
    updated_at: int


class WorkflowListResponse(BaseModel):
    workflows: list[WorkflowSummaryResponse]


class PipelineLogEvent(BaseModel):
    type: Literal["pipeline_log"] = "pipeline_log"
    stage: str
    message: str
    progress: int
    timestamp: int
