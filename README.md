# SkillForge

An AI-powered knowledge transfer platform that bridges the gap between expert practitioners and trainees — across both digital software workflows and hands-on physical tasks.

---

## Overview

SkillForge lets experts record what they know, and lets AI turn those recordings into structured, interactive learning experiences for trainees. It supports three distinct modes:

### 1. Digital Workflow
Experts screen-record themselves performing software tasks. The AI pipeline — powered by NVIDIA Nemotron VL and Claude — automatically extracts steps, identifies UI elements, and generates annotations. Trainees replay these recordings with live visual overlays and a built-in Claude copilot for guided assistance.

### 2. Physical Apprenticeship
Experts record video of physical demonstrations. Optical flow isolates key frames, and Claude Vision extracts structured steps. During a trainee session, MediaPipe hand tracking, YOLOv8 object detection, and Grounding DINO work together to deliver real-time AR-style overlays that guide the trainee through each step.

### 3. Live Camera Detection
A standalone mode with no workflow required. Point a camera, toggle detectors — hand tracking, YOLO objects, and custom text-prompted detection — and see real-time overlays on the camera feed.

---

## Tech Stack

### Frontend (`skillforge/`)

| Technology | Role |
|---|---|
| Next.js 16 + React 19 + TypeScript | Application framework |
| TailwindCSS 4 | Styling |
| Fabric.js | Canvas-based annotation editor |
| Zustand | Global state management |
| Framer Motion | Animations and transitions |
| WebSockets (native) | Real-time pipeline progress and live session events |

### Backend (`skillforge-api/`)

| Technology | Role |
|---|---|
| Python FastAPI + uvicorn | API server |
| Neon PostgreSQL (asyncpg) | Primary database |
| SQLite (aiosqlite) | Local development fallback |
| Cloudflare R2 (boto3 / S3-compatible) | Video and media storage |
| Local `/uploads/` directory | Storage fallback for development |
| FastAPI WebSocket | Real-time pipeline and session events |

### AI and ML Services

| Service | Technology | Purpose |
|---|---|---|
| Frame analysis | NVIDIA Nemotron VL (NIM API) | Analyze video frames for UI and software context |
| Step extraction | Claude Sonnet 4.6 (Anthropic API) | Decompose frames into annotated steps |
| Hand tracking | MediaPipe Hands | Detect hands and fingertip pointing |
| Object detection | YOLOv8n (ultralytics) | Detect UI elements and physical objects |
| Custom detection | Grounding DINO 1.5 (optional) | Open-vocabulary object detection via text prompts |
| Fallback detection | Claude Vision | Object localization when Grounding DINO is unavailable |
| Segmentation | SAM 2 (optional) | Segment detected objects |
| Feature extraction | DINOv2 (optional) | Visual fingerprints for object re-identification |

---

## Project Structure

```
skillforge/
├── skillforge/                  # Next.js frontend
│   ├── app/
│   │   ├── (expert)/            # Expert routes: /record, /workflows, /editor/[id]
│   │   ├── (trainee)/           # Trainee routes: /library, /learn/[id]
│   │   ├── (physical)/          # Physical routes: /tasks, /capture, /guide/[id]
│   │   └── live/                # Standalone live camera detection
│   ├── components/              # Modular UI components
│   ├── hooks/                   # React hooks (camera, detection, sessions, pipelines)
│   ├── lib/                     # API clients, constants, utilities
│   ├── store/                   # Zustand stores
│   └── types/                   # TypeScript type definitions
└── skillforge-api/              # FastAPI backend
    ├── models/                  # Database layer (asyncpg + aiosqlite)
    ├── routers/                 # API route handlers
    ├── services/                # ML services, pipelines, storage
    ├── websockets/              # WebSocket broadcast management
    └── utils/                   # Shared utilities
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- `pip` and `npm` (or `pnpm`)

### 1. Clone and set up the backend

```bash
cd skillforge-api
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your API keys — see the Environment Variables section below
uvicorn main:app --reload --port 8000
```

### 2. Set up the frontend

```bash
cd skillforge
npm install
cp .env.example .env.local   # or create manually
# Set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

### 3. Open the app

Navigate to [http://localhost:3000](http://localhost:3000)

---

## Environment Variables

### Backend (`skillforge-api/.env`)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for step extraction, copilot, and vision fallback |
| `NVIDIA_NIM_API_KEY` | Recommended | Nemotron VL for frame analysis. Falls back to Claude if unset. |
| `DATABASE_URL` | Optional | Neon PostgreSQL connection string. Uses local SQLite if unset. |
| `CORS_ORIGINS` | Optional | Comma-separated allowed origins. Default: `http://localhost:3000` |
| `CF_R2_ACCOUNT_ID` | Optional | Cloudflare account ID for R2 video storage |
| `CF_R2_ACCESS_KEY_ID` | Optional | R2 API token access key |
| `CF_R2_SECRET_ACCESS_KEY` | Optional | R2 API token secret key |
| `CF_R2_BUCKET_NAME` | Optional | R2 bucket name. Default: `skillforge-media` |
| `CF_R2_PUBLIC_URL` | Optional | Public CDN URL for the R2 bucket (e.g. `https://pub-xxx.r2.dev`) |
| `GROUNDING_DINO_URL` | Optional | Local Grounding DINO server URL. Uses Claude fallback if unset. |
| `SAM2_URL` | Optional | Local SAM 2 server URL. Skipped if unset. |
| `DINOV2_URL` | Optional | Local DINOv2 server URL. Skipped if unset. |

### Frontend (`skillforge/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Optional | Backend base URL. Default: `http://localhost:8000` |

---

## Workflows

### Digital Workflow (Expert to Trainee)

1. Expert navigates to `/record` and selects Software or Hardware mode.
2. Expert records their screen or webcam while performing a task.
3. The AI pipeline runs automatically: frame extraction, Nemotron VL frame analysis, YOLO and MediaPipe detection, Claude step decomposition.
4. Expert reviews and annotates steps in the workflow editor at `/editor/[id]`.
5. Trainee browses the library at `/library` and opens a workflow at `/learn/[id]`.
6. Trainee watches the video with AI-drawn overlays and uses the built-in Claude copilot chat for real-time guidance.

### Physical Apprenticeship (Expert to Trainee)

1. Expert navigates to `/capture` and uploads a video of performing a physical task.
2. The physical AI pipeline runs: optical flow key frame extraction, Claude VLM step decomposition, Grounding DINO object detection, DINOv2 visual fingerprinting.
3. Trainee browses tasks at `/tasks` and starts a guided session at `/guide/[id]`.
4. The camera displays live object detection overlays; Claude Vision checks step completion in real time.

### Live Camera Detection

1. Navigate to `/live`.
2. Enable the camera.
3. Toggle individual detectors: Hand Tracking (MediaPipe), YOLO Objects, or Custom Prompt (Grounding DINO with Claude fallback).
4. Real-time overlays are drawn directly on the camera feed.

---

## Database Setup (Neon PostgreSQL)

1. Create a free project at [https://neon.tech](https://neon.tech).
2. Copy the connection string from the Neon dashboard.
3. Set `DATABASE_URL` in `skillforge-api/.env`.
4. Tables are created automatically on the first server startup — no manual migrations needed.

If `DATABASE_URL` is not set, the backend will fall back to a local SQLite database, which is sufficient for development and testing.

---

## Storage Setup (Cloudflare R2)

1. Log in to the Cloudflare dashboard, navigate to R2, and create a bucket named `skillforge-media`.
2. Enable public access on the bucket.
3. Navigate to R2 > Manage API Tokens and create a token with Object Read and Write permissions.
4. Collect your Account ID, Access Key ID, Secret Access Key, and the public bucket URL.
5. Set all `CF_R2_*` variables in `skillforge-api/.env`.

If R2 is not configured, uploaded files are served from the local `skillforge-api/uploads/` directory instead.

---

## ML Service Stubs (Optional)

For production-quality object detection, you can run local inference servers for the following services. Without them, Claude Vision is used as a fallback for detection tasks.

### Grounding DINO 1.5 — Open-vocabulary detection

```
POST /predict
Content-Type: multipart/form-data

Fields:
  image      (file)   — image file
  prompt     (str)    — text prompt describing objects to detect
  threshold  (float)  — confidence threshold

Response:
  {"boxes": [{"box": [x1, y1, x2, y2], "score": float}]}
```

Set `GROUNDING_DINO_URL` to your local server URL.

### SAM 2 — Object segmentation

```
POST /segment
Content-Type: multipart/form-data

Fields:
  image  (file)  — image file
  box    (str)   — normalized bounding box as "x1,y1,x2,y2"

Response:
  {"mask_path": "path/to/mask.png"}
```

Set `SAM2_URL` to your local server URL.

### DINOv2 — Visual feature extraction

```
POST /extract
Content-Type: multipart/form-data

Fields:
  image  (file)  — image file

Response:
  {"features": [float, ...]}
```

Set `DINOV2_URL` to your local server URL.

---

## Fallback Behavior Summary

| Component | Primary | Fallback |
|---|---|---|
| Frame analysis | NVIDIA Nemotron VL | Claude Vision |
| Object detection | Grounding DINO 1.5 | Claude Vision |
| Segmentation | SAM 2 | Skipped |
| Feature extraction | DINOv2 | Skipped |
| Database | Neon PostgreSQL | Local SQLite |
| File storage | Cloudflare R2 | Local `/uploads/` |

SkillForge is designed to be fully functional with only an `ANTHROPIC_API_KEY`, making it straightforward to run locally without any cloud infrastructure.

---

## License

This project is for internal and educational use. See individual service documentation for third-party licensing terms (Ultralytics YOLOv8, Meta SAM 2, Grounding DINO, DINOv2, NVIDIA NIM, Anthropic Claude).
# skillforge
