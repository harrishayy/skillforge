# SkillForge API

FastAPI backend for SkillForge. Handles video processing pipelines, AI step extraction, real-time object detection, and live apprenticeship session management.

---

## Running

```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

API docs available at http://localhost:8000/docs

---

## Database

- **Development**: SQLite (`skillforge.db`) — used when `DATABASE_URL` is unset
- **Production**: Neon PostgreSQL — set `DATABASE_URL=postgresql://...`
- Tables are created automatically on first startup via `asyncpg` or `aiosqlite`

---

## All API Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Returns `{status, service}` |

---

### Digital Workflows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows` | List all workflows |
| `GET` | `/api/workflows/{id}` | Workflow detail with steps and annotations |
| `POST` | `/api/workflows/upload` | Upload video — multipart: `video` (file), `title`, `description`, `mode`, `input_events_json` |
| `PATCH` | `/api/workflows/{id}` | Update title or description |
| `DELETE` | `/api/workflows/{id}` | Delete a workflow |

---

### Steps & Annotations (Editor)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows/{id}/steps` | All steps for a workflow |
| `PATCH` | `/api/steps/{id}` | Update step title or description |
| `DELETE` | `/api/steps/{id}` | Delete a step |
| `POST` | `/api/steps/{id}/annotations` | Create annotation — types: `bounding_box`, `arrow`, `highlight`, `text_label` |
| `PATCH` | `/api/annotations/{id}` | Update an annotation |
| `DELETE` | `/api/annotations/{id}` | Delete an annotation |
| `POST` | `/api/steps/{id}/click-targets` | Add a click target to a step |
| `DELETE` | `/api/click-targets/{id}` | Delete a click target |

---

### Pipeline (WebSocket + REST)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows/{id}/pipeline-logs` | Retrieve past pipeline log entries |
| `WS` | `/ws/pipeline/{workflow_id}` | Real-time pipeline events: `pipeline_log`, `complete`, `error` |

---

### Copilot

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/copilot/chat` | SSE streaming chat — body: `{workflow_id, step_id, message, history}` → streamed Claude response |
| `POST` | `/api/copilot/generate-instructions/{step_id}` | Auto-generate step instructions via Claude |

---

### Physical Workflows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/physical/workflows` | List all physical workflows |
| `GET` | `/api/physical/workflows/{id}` | Full detail with steps, anchors, and fingerprints |
| `POST` | `/api/physical/upload` | Upload video — multipart: `video` (file), `title`, `description` |
| `PATCH` | `/api/physical/workflows/{id}` | Update a physical workflow |
| `DELETE` | `/api/physical/workflows/{id}` | Delete a physical workflow |
| `GET` | `/api/physical/workflows/{id}/steps/{step_id}` | Single step detail |

---

### Live Sessions (AR Guidance)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/live/sessions` | Create session — body: `{workflow_id}` → `LiveSession` |
| `GET` | `/api/live/sessions/{id}` | Get session detail |
| `PATCH` | `/api/live/sessions/{id}` | Update session status or current step |
| `POST` | `/api/live/sessions/{id}/complete-step` | Advance to the next step |
| `POST` | `/api/live/sessions/{id}/detect` | Object detection — body: `{frame_base64, step_id}` → detection result |
| `POST` | `/api/live/sessions/{id}/check-completion` | Check step completion — body: `{frame_base64, step_number}` → `{is_complete, confidence, notes}` |
| `DELETE` | `/api/live/sessions/{id}` | End and delete a session |
| `WS` | `/ws/live/{session_id}` | Real-time session events |

---

### Live Camera Detection (no workflow needed)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/live/detect-frame` | Multi-mode frame detection — see below |

**Request body:**

```json
{
  "frame_base64": "<base64-encoded frame>",
  "modes": ["hands", "yolo", "custom"],
  "text_prompt": "optional object description",
  "confidence_threshold": 0.5
}
```

**`modes`** is an array of one or more of:
- `"hands"` — MediaPipe hand tracking
- `"yolo"` — YOLOv8n object detection
- `"custom"` — Grounding DINO or Claude open-vocab detection

**Response shape:**

```json
{
  "hands": {
    "hand_count": 1,
    "hands": [{ "landmarks": [...] }],
    "pointing_at": { "x": 0.42, "y": 0.31 }
  },
  "yolo_detections": [
    {
      "class": "mouse",
      "confidence": 0.91,
      "bbox_x": 120,
      "bbox_y": 200,
      "bbox_width": 60,
      "bbox_height": 40
    }
  ],
  "custom_detection": {
    "bbox": [x, y, w, h],
    "confidence": 0.78
  },
  "processing_ms": 143
}
```

---

### 3D Reconstruction

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reconstruction/{workflow_id}/status` | Get reconstruction job status |
| `POST` | `/api/reconstruction/{workflow_id}/trigger` | Trigger a new reconstruction job |
| `PATCH` | `/api/reconstruction/{workflow_id}/status` | Update reconstruction job status |

---

## ML Services

| Service | File | Purpose | Availability |
|---------|------|---------|-------------|
| MediaPipe Hands | `services/mediapipe_tracker.py` | Hand tracking + fingertip pointing | Always (bundled) |
| YOLOv8n | `services/yolo_detector.py` | Object/UI element detection | Always (auto-downloads model) |
| Nemotron VL | `services/nemotron_client.py` | Frame-level VL analysis for digital workflows | Requires `NVIDIA_NIM_API_KEY` |
| Claude Sonnet | `services/claude_orchestrator.py` | Step decomposition, copilot, completion check | Requires `ANTHROPIC_API_KEY` |
| Grounding DINO | `services/grounding_dino_service.py` | Open-vocab custom object detection | Optional (`GROUNDING_DINO_URL`), Claude fallback |
| SAM 2 | `services/sam2_service.py` | Object segmentation | Optional (`SAM2_URL`) |
| DINOv2 | `services/dinov2_service.py` | Visual feature extraction for re-ID | Optional (`DINOV2_URL`) |
| Optical Flow | `services/optical_flow_service.py` | Key frame extraction for physical videos | Always (OpenCV) |

---

## Storage

- **Local**: Videos saved to `uploads/videos/`, frames to `uploads/frames/` (served as static files at `/uploads`)
- **Cloudflare R2**: When `CF_R2_*` env vars are set, media is uploaded post-pipeline to R2 CDN and URLs are stored in the database

---

## Environment Variables

Full list with descriptions is in `.env.example`.

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |

### Recommended

| Variable | Description |
|----------|-------------|
| `NVIDIA_NIM_API_KEY` | Nemotron VL — falls back to Claude-only analysis if unset |
| `DATABASE_URL` | Neon PostgreSQL URL — SQLite fallback if unset |

### Optional — Cloud Storage (Cloudflare R2)

| Variable | Description |
|----------|-------------|
| `CF_R2_ACCOUNT_ID` | Cloudflare account ID |
| `CF_R2_ACCESS_KEY_ID` | R2 access key |
| `CF_R2_SECRET_ACCESS_KEY` | R2 secret key |
| `CF_R2_BUCKET_NAME` | R2 bucket name |
| `CF_R2_PUBLIC_URL` | Public CDN base URL for R2 assets |

### Optional — Enhanced ML

| Variable | Description |
|----------|-------------|
| `GROUNDING_DINO_URL` | Self-hosted Grounding DINO inference endpoint |
| `SAM2_URL` | Self-hosted SAM 2 inference endpoint |
| `DINOV2_URL` | Self-hosted DINOv2 inference endpoint |

---

## Pipeline Architecture

### Digital Workflow Pipeline

```
Video upload → extract_frames() [OpenCV scene detection]
            → analyze_frames_batch() [Nemotron VL or Claude]
            → detect_ui_elements() [YOLO] or extract_hand_data() [MediaPipe]
            → decompose_workflow() [Claude — structured step JSON]
            → persist to DB
            → upload to R2 (if configured)
            → broadcast WS complete
```

### Physical Workflow Pipeline

```
Video upload → extract_physical_keyframes() [OpenCV optical flow]
            → _extract_steps_with_vlm() [Claude vision — spatial step JSON]
            → detect_object() [Grounding DINO or Claude] per step
            → extract_features() [DINOv2] per step
            → persist steps + fingerprints to DB
            → upload to R2 (if configured)
            → broadcast WS complete
```

---

## Database Schema

### Digital Workflow Tables

#### `workflows`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `title` | text | Workflow name |
| `mode` | text | `software` or `hardware` |
| `status` | text | Pipeline processing status |
| `video_path` | text | Local or R2 path |
| `duration_ms` | integer | Video duration in milliseconds |

#### `steps`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `workflow_id` | integer | Foreign key → `workflows` |
| `step_number` | integer | Ordered position |
| `title` | text | Step title |
| `description` | text | Step instructions |
| `start_ms` | integer | Start timestamp in ms |
| `end_ms` | integer | End timestamp in ms |
| `key_frame_path` | text | Representative frame image path |

#### `annotations`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `step_id` | integer | Foreign key → `steps` |
| `type` | text | `bounding_box`, `arrow`, `highlight`, or `text_label` |
| `coordinates` | json | Shape coordinates |
| `color` | text | Hex or named color |

#### `click_targets`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `step_id` | integer | Foreign key → `steps` |
| `element_text` | text | Label of the UI element |
| `bbox` | json | Bounding box coordinates |
| `action` | text | Interaction type (click, scroll, etc.) |

#### `input_events`
Recorded keyboard, click, and scroll events captured during software screen recording.

#### `pipeline_logs`
| Column | Type | Notes |
|--------|------|-------|
| `workflow_id` | integer | Foreign key → `workflows` |
| `stage` | text | Pipeline stage name |
| `message` | text | Log message |
| `progress` | float | 0.0 – 1.0 |

---

### Physical Workflow Tables

#### `physical_workflows`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `title` | text | Workflow name |
| `status` | text | Pipeline processing status |
| `video_path` | text | Local or R2 path |
| `thumbnail_path` | text | Cover image path |

#### `physical_steps`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `workflow_id` | integer | Foreign key → `physical_workflows` |
| `target_object` | json | Object description and detection hints |
| `completion_criteria` | text | How to verify step is done |
| `safety_notes` | text | Safety information for the trainee |
| `key_frame_path` | text | Representative frame image path |

#### `spatial_anchors`
3D world coordinates per step, reserved for future AR overlay positioning.

#### `object_fingerprints`
DINOv2 feature descriptor file paths per step, used for visual re-identification during live sessions.

#### `live_sessions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `workflow_id` | integer | Foreign key → `physical_workflows` |
| `current_step` | integer | Active step number |
| `status` | text | `active`, `paused`, `completed`, or `abandoned` |

#### `session_events`
Timestamped event log entries per live session (detection results, step advances, errors).

#### `reconstruction_jobs`
COLMAP / 3D reconstruction job status tracking per workflow.
