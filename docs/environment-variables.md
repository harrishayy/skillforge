# Environment Variables

Consolidated reference for every environment variable used across SkillForge services.

---

## API Server (`skillforge-api/.env`)

Copy from the template to get started:

```bash
cd skillforge-api
cp .env.example .env
```

### API Keys

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Claude API key for step extraction, copilot chat, vision fallback, and completion checking |
| `NVIDIA_NIM_API_KEY` | Recommended | NVIDIA Nemotron VL for frame analysis. Falls back to Claude Vision if unset |

### Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | Neon PostgreSQL connection string (`postgresql://...`) |

Example:

```
DATABASE_URL='postgresql://neondb_owner:YOUR_PASSWORD@ep-your-endpoint.region.aws.neon.tech/neondb?sslmode=require'
```

Setup details: [API Server Setup — Database](api-server-setup.md#database)

### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated allowed origins for CORS |
| `UPLOAD_DIR` | No | `uploads` | Local directory for uploaded videos and extracted frames |

### ML Inference Servers

All ML server URLs are optional. Without them, the system degrades gracefully — Claude Vision handles detection tasks, segmentation is skipped, and speech recognition falls back to the browser Web Speech API.

| Variable | Service | Expected Endpoint | Description |
|---|---|---|---|
| `SAM3_URL` | SAM 3 | `POST /segment` | Concept segmentation from text or box prompt (Brev GPU, port 8080 → local 8090) |
| `ASR_URL` | Parakeet TDT 1.1B | `POST /transcribe` | Speech recognition / transcription (Brev GPU, port 8081 → local 8091) |
| `NEMOTRON_URL` | Nemotron Nano 12B VL | `POST /v1/chat/completions` | Vision-language frame analysis (Brev GPU, port 8082 → local 8092) |
| `GROUNDING_DINO_URL` | Grounding DINO 1.5 | `POST /predict` | Open-vocabulary object detection via text prompt |
| `SAM2_URL` | SAM 2 | `POST /segment` | Object segmentation from bounding box |

Port forwarding and setup: [GPU Services Setup](gpu-services-setup.md). SAM 3 deployment details: [SAM 3 GPU Deployment](sam3-gpu-deployment.md)

---

## AR WebSocket Server (`skillforge/backend/`)

The AR server reads environment variables directly (no `.env` file by default).

| Variable | Required | Default | Description |
|---|---|---|---|
| `MEDIAPIPE_DELEGATE` | No | *(auto)* | `cpu` to force CPU, `gpu` to require GPU, or unset to try GPU then fall back |

Setup details: [AR WebSocket Server](ar-websocket-server.md#gpu-vs-cpu-delegate)

---

## Frontend (`skillforge/.env.local`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:8000` | Base URL for the FastAPI API server |
| `NEXT_PUBLIC_WS_HOST` | No | *(derived)* | WebSocket host override for backend connections |

Setup details: [Frontend Setup — Environment](frontend-setup.md#environment)

---

## Minimal Setup

To run SkillForge with the least configuration:

```bash
# skillforge-api/.env
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else uses local fallbacks (local file storage, Claude Vision for detection). No cloud infrastructure required beyond Neon.
