# API Server Setup

FastAPI backend for SkillForge. Handles video processing pipelines, AI step extraction, real-time object detection, and live apprenticeship session management.

---

## Prerequisites

- Python 3.11+
- `pip` (or `uv`)

---

## Installation

```bash
cd skillforge-api
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your API keys. At minimum you need `ANTHROPIC_API_KEY`. See the [Environment Variables](environment-variables.md) reference for the full list.

---

## Running

```bash
uvicorn main:app --reload --port 8000
```

Interactive API docs are available at [http://localhost:8000/docs](http://localhost:8000/docs).

---

## Database

- **Development** — SQLite (`skillforge.db`), used automatically when `DATABASE_URL` is unset.
- **Production** — Neon PostgreSQL, set `DATABASE_URL=postgresql://...`.
- Tables are created automatically on first startup — no manual migrations needed.

### Setting up Neon PostgreSQL

1. Create a free project at [https://neon.tech](https://neon.tech).
2. Copy the connection string from the Neon dashboard.
3. Set `DATABASE_URL` in `.env`:

```
DATABASE_URL='postgresql://neondb_owner:YOUR_PASSWORD@ep-your-endpoint.region.aws.neon.tech/neondb?sslmode=require'
```

---

## Storage

Videos are saved to `uploads/videos/`, frames to `uploads/frames/`, and served as static files at `/uploads`.

---

## ML Services

| Service | File | Purpose | Availability |
|---------|------|---------|-------------|
| MediaPipe Hands | `services/mediapipe_tracker.py` | Hand tracking + fingertip pointing | Always (bundled) |
| YOLOv8n | `services/yolo_detector.py` | Object / UI element detection | Always (auto-downloads model) |
| Nemotron VL | `services/nemotron_client.py` | Frame-level VL analysis for digital workflows | Requires `NVIDIA_NIM_API_KEY` |
| Claude Sonnet | `services/claude_orchestrator.py` | Step decomposition, copilot, completion check | Requires `ANTHROPIC_API_KEY` |
| Grounding DINO | `services/grounding_dino_service.py` | Open-vocab custom object detection | Optional (`GROUNDING_DINO_URL`), Claude fallback |
| SAM 2 | `services/sam2_service.py` | Object segmentation | Optional (`SAM2_URL`) |
| SAM 3 | `services/sam3_service.py` | Concept segmentation (text/box prompt, remote GPU) | Optional (`SAM3_URL`) |
| DINOv2 | `services/dinov2_service.py` | Visual feature extraction for re-ID | Optional (`DINOV2_URL`) |
| Optical Flow | `services/optical_flow_service.py` | Key frame extraction for physical videos | Always (OpenCV) |

### Optional ML inference servers

For production-quality detection, you can run local inference servers. Without them, Claude Vision is used as a fallback.

**Grounding DINO 1.5** — Open-vocabulary detection

```
POST /predict  (multipart/form-data)
Fields:  image (file), prompt (str), threshold (float)
Response:  {"boxes": [{"box": [x1, y1, x2, y2], "score": float}]}
```

Set `GROUNDING_DINO_URL` to your server URL.

**SAM 2** — Object segmentation

```
POST /segment  (multipart/form-data)
Fields:  image (file), box (str — "x1,y1,x2,y2" normalized)
Response:  {"mask_path": "path/to/mask.png"}
```

Set `SAM2_URL` to your server URL.

**SAM 3** — Concept segmentation (text or box prompt, remote GPU). See [SAM 3 GPU Deployment](sam3-gpu-deployment.md).

**DINOv2** — Visual feature extraction

```
POST /extract  (multipart/form-data)
Fields:  image (file)
Response:  {"features": [float, ...]}
```

Set `DINOV2_URL` to your server URL.

---

## API Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Returns `{status, service}` |

### Digital Workflows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows` | List all workflows |
| `GET` | `/api/workflows/{id}` | Workflow detail with steps and annotations |
| `POST` | `/api/workflows/upload` | Upload video — multipart: `video` (file), `title`, `description`, `mode`, `input_events_json` |
| `PATCH` | `/api/workflows/{id}` | Update title or description |
| `DELETE` | `/api/workflows/{id}` | Delete a workflow |

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

### Pipeline (WebSocket + REST)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows/{id}/pipeline-logs` | Retrieve past pipeline log entries |
| `WS` | `/ws/pipeline/{workflow_id}` | Real-time pipeline events: `pipeline_log`, `complete`, `error` |

### Copilot

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/copilot/chat` | SSE streaming chat — body: `{workflow_id, step_id, message, history}` |
| `POST` | `/api/copilot/generate-instructions/{step_id}` | Auto-generate step instructions via Claude |

### Physical Workflows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/physical/workflows` | List all physical workflows |
| `GET` | `/api/physical/workflows/{id}` | Full detail with steps, anchors, and fingerprints |
| `POST` | `/api/physical/upload` | Upload video — multipart: `video` (file), `title`, `description` |
| `PATCH` | `/api/physical/workflows/{id}` | Update a physical workflow |
| `DELETE` | `/api/physical/workflows/{id}` | Delete a physical workflow |
| `GET` | `/api/physical/workflows/{id}/steps/{step_id}` | Single step detail |

### Live Sessions (AR Guidance)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/live/sessions` | Create session — body: `{workflow_id}` |
| `GET` | `/api/live/sessions/{id}` | Get session detail |
| `PATCH` | `/api/live/sessions/{id}` | Update session status or current step |
| `POST` | `/api/live/sessions/{id}/complete-step` | Advance to the next step |
| `POST` | `/api/live/sessions/{id}/detect` | Object detection — body: `{frame_base64, step_id}` |
| `POST` | `/api/live/sessions/{id}/check-completion` | Check step completion — body: `{frame_base64, step_number}` |
| `DELETE` | `/api/live/sessions/{id}` | End and delete a session |
| `WS` | `/ws/live/{session_id}` | Real-time session events |

### Live Camera Detection (no workflow needed)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/live/detect-frame` | Multi-mode frame detection |

**Request body:**

```json
{
  "frame_base64": "<base64-encoded JPEG>",
  "modes": ["hands", "sam3"],
  "text_prompt": "optional object description",
  "confidence_threshold": 0.35
}
```

**`modes`** is an array of one or more of:
- `"hands"` — MediaPipe hand tracking
- `"yolo"` — YOLOv8n object detection
- `"sam3"` — SAM 3 concept segmentation (requires `text_prompt`)
- `"custom"` — Grounding DINO or Claude open-vocab detection

**Response:**

```json
{
  "hands": {
    "hand_count": 1,
    "hands": [{ "landmarks": [...] }],
    "pointing_at": { "x": 42.0, "y": 31.0 }
  },
  "sam3_segments": [
    { "mask_base64": "...", "bbox": [0.1, 0.2, 0.5, 0.6], "score": 0.92 }
  ],
  "processing_ms": 143
}
```

### 3D Reconstruction

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reconstruction/{workflow_id}/status` | Get reconstruction job status |
| `POST` | `/api/reconstruction/{workflow_id}/trigger` | Trigger a new reconstruction job |
| `PATCH` | `/api/reconstruction/{workflow_id}/status` | Update reconstruction job status |

---

## Pipeline Architecture

### Digital Workflow Pipeline

```
Video upload
  → extract_frames()              [OpenCV scene detection]
  → analyze_frames_batch()        [Nemotron VL or Claude]
  → detect_ui_elements()          [YOLO] / extract_hand_data() [MediaPipe]
  → decompose_workflow()          [Claude — structured step JSON]
  → persist to DB
  → broadcast WS complete
```

### Physical Workflow Pipeline

```
Video upload
  → extract_physical_keyframes()  [OpenCV optical flow]
  → _extract_steps_with_vlm()     [Claude vision — spatial step JSON]
  → detect_object()               [Grounding DINO or Claude] per step
  → extract_features()            [DINOv2] per step
  → persist steps + fingerprints to DB
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
| `video_path` | text | Local path |
| `duration_ms` | integer | Video duration in milliseconds |

#### `steps`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `workflow_id` | integer | FK → `workflows` |
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
| `step_id` | integer | FK → `steps` |
| `type` | text | `bounding_box`, `arrow`, `highlight`, or `text_label` |
| `coordinates` | json | Shape coordinates |
| `color` | text | Hex or named color |

#### `click_targets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `step_id` | integer | FK → `steps` |
| `element_text` | text | Label of the UI element |
| `bbox` | json | Bounding box coordinates |
| `action` | text | Interaction type (click, scroll, etc.) |

#### `input_events`

Recorded keyboard, click, and scroll events captured during software screen recording.

#### `pipeline_logs`

| Column | Type | Notes |
|--------|------|-------|
| `workflow_id` | integer | FK → `workflows` |
| `stage` | text | Pipeline stage name |
| `message` | text | Log message |
| `progress` | float | 0.0 – 1.0 |

### Physical Workflow Tables

#### `physical_workflows`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `title` | text | Workflow name |
| `status` | text | Pipeline processing status |
| `video_path` | text | Local path |
| `thumbnail_path` | text | Cover image path |

#### `physical_steps`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `workflow_id` | integer | FK → `physical_workflows` |
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
| `workflow_id` | integer | FK → `physical_workflows` |
| `current_step` | integer | Active step number |
| `status` | text | `active`, `paused`, `completed`, or `abandoned` |

#### `session_events`

Timestamped event log entries per live session (detection results, step advances, errors).

#### `reconstruction_jobs`

COLMAP / 3D reconstruction job status tracking per workflow.
