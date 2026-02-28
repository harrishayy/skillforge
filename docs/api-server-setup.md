# API Server Setup

FastAPI backend for SkillForge. Handles video processing pipelines, AI step extraction, real-time object detection, and copilot chat.

---

## Prerequisites

- Python 3.10+
- `pip`

---

## Installation

```bash
cd skillforge-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your API keys. At minimum you need `ANTHROPIC_API_KEY`. See the [Environment Variables](environment-variables.md) reference for the full list.

---

## Running

```bash
cd skillforge-api
source venv/bin/activate
uvicorn main:app --reload --port 8000 --ws wsproto
```

> **Note:** The `--ws wsproto` flag is required. Without it, uvicorn attempts to use the `websockets` library whose `legacy` module is incompatible with current versions. `wsproto` is included in `requirements.txt`.

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
| Nemotron VL | `services/nemotron_client.py` | Frame-level VL analysis for digital workflows | Requires `NVIDIA_NIM_API_KEY` |
| Claude Sonnet | `services/claude_orchestrator.py` | Step decomposition, copilot, completion check | Requires `ANTHROPIC_API_KEY` |
| Grounding DINO | `services/grounding_dino_service.py` | Open-vocab custom object detection | Optional (`GROUNDING_DINO_URL`), Claude fallback |
| SAM 2 | `services/sam2_service.py` | Object segmentation | Optional (`SAM2_URL`) |
| SAM 3 | `services/sam3_service.py` | Concept segmentation (text/box prompt, remote GPU) | Optional (`SAM3_URL`) |

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
| `POST` | `/api/workflows/upload` | Upload video — multipart: `video` (file), `title`, `description`, `mode` |
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

### Live Camera Detection

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

### Voice & ASR

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/voice/classify-intent` | Classify a voice transcript into an intent (`next`, `prev`, `finish`, `none`) |
| `POST` | `/api/asr/transcribe` | Transcribe an audio clip |

### Guided Recording

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/guided-recording/step-prompt` | Get an AI-generated prompt for the next recording step |

---

## Pipeline Architecture

### Digital Workflow Pipeline

```
Video upload
  → extract_frames()              [OpenCV scene detection]
  → analyze_frames_batch()        [Nemotron VL or Claude]
  → extract_hand_data()           [MediaPipe]
  → decompose_workflow()          [Claude — structured step JSON]
  → persist to DB
  → broadcast WS complete
```

---

## Database Schema

### `workflows`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `title` | text | Workflow name |
| `mode` | text | `software` or `hardware` |
| `status` | text | Pipeline processing status |
| `video_path` | text | Local path |
| `duration_ms` | integer | Video duration in milliseconds |

### `steps`

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

### `annotations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `step_id` | integer | FK → `steps` |
| `type` | text | `bounding_box`, `arrow`, `highlight`, or `text_label` |
| `coordinates` | json | Shape coordinates |
| `color` | text | Hex or named color |

### `click_targets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `step_id` | integer | FK → `steps` |
| `element_text` | text | Label of the UI element |
| `bbox` | json | Bounding box coordinates |
| `action` | text | Interaction type (click, scroll, etc.) |

### `pipeline_logs`

| Column | Type | Notes |
|--------|------|-------|
| `workflow_id` | integer | FK → `workflows` |
| `stage` | text | Pipeline stage name |
| `message` | text | Log message |
| `progress` | float | 0.0 – 1.0 |
