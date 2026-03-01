# SkillForge

An AI-powered knowledge transfer platform that bridges the gap between expert practitioners and trainees — capturing expert workflows through video recording and turning them into structured, interactive learning experiences.

---

## Overview

SkillForge lets experts record what they know, and lets AI turn those recordings into structured, interactive learning experiences for trainees.

**Expert Recording** — Experts record themselves performing tasks via webcam with voice narration. An AI pipeline (NVIDIA Nemotron VL + Claude) extracts steps, identifies key moments, and generates annotations. Experts can then refine steps in a visual editor.

**Trainee Learning** — Trainees browse a library of published workflows and replay recordings with AI-drawn overlays and a built-in Claude copilot chat for real-time guidance.

**Live Camera Detection** — A standalone mode with no workflow required. Point a camera, toggle detectors (hand tracking, SAM 3 concept segmentation), and see real-time overlays on the camera feed.

---

## Architecture

```mermaid
graph TB
    Browser["Next.js Frontend<br/>localhost:3000"]

    API["FastAPI API Server<br/>localhost:8000"]
    AR["AR WebSocket Server<br/>localhost:8001"]
    SAM3["SAM 3 GPU Server<br/>NVIDIA Brev"]

    NeonDB["Neon PostgreSQL"]
    Claude["Anthropic Claude"]
    Nemotron["NVIDIA Nemotron VL"]

    Browser -->|"REST + WebSocket"| API
    Browser -->|"WebSocket"| AR
    API -->|"HTTP"| SAM3
    API --> NeonDB
    API --> Claude
    API --> Nemotron
    AR -->|"MediaPipe"| Browser
```

| Component | Port | Description | Required |
|---|---|---|---|
| **Frontend** | 3000 | Next.js 16 / React 19 web app | Yes |
| **API Server** | 8000 | FastAPI backend — pipelines, detection, storage, copilot | Yes |
| **AR WebSocket Server** | 8001 | Dedicated FastAPI process for real-time hand tracking over WebSocket | Optional |
| **SAM 3 GPU Server** | 8080 (remote) | Inference server for concept segmentation, deployed on NVIDIA Brev | Optional |

---

## Tech Stack

- **Frontend** — Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zustand, Fabric.js, Framer Motion
- **Backend** — Python FastAPI, uvicorn, Neon PostgreSQL (asyncpg), SQLite fallback
- **AI / ML** — Claude Sonnet (Anthropic), Nemotron VL (NVIDIA NIM), MediaPipe Hands, Grounding DINO 1.5, SAM 2/3
- **Real-time** — WebSockets for pipeline progress and AR hand tracking

---

## Project Structure

```
skillforge/
├── skillforge/                  # Next.js frontend
│   ├── app/                     # App Router pages
│   │   ├── (expert)/            # Expert routes: /workflows, /editor/[id]
│   │   ├── (trainee)/           # Trainee routes: /library, /learn/[id]
│   │   ├── record/              # Recording flow: /record, /record/setup, /record/session
│   │   └── live/                # Live camera detection: /live
│   ├── components/              # Modular UI components
│   ├── hooks/                   # React hooks (camera, detection, sessions)
│   ├── lib/                     # API clients, constants, utilities
│   ├── store/                   # Zustand stores
│   └── backend/                 # AR WebSocket server (separate process)
├── skillforge-api/              # FastAPI API server
│   ├── models/                  # Database layer (asyncpg + aiosqlite)
│   ├── routers/                 # API route handlers
│   ├── services/                # ML services, pipelines, storage
│   └── websockets/              # WebSocket broadcast management
├── deploy/                      # GPU deployment scripts
│   └── sam3_server.py           # SAM 3 inference server for NVIDIA Brev
└── docs/                        # Setup guides
```

---

## Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| Python | 3.10+ | API server and AR WebSocket server |
| Node.js | 18+ | Next.js frontend |
| pnpm | latest | Frontend package manager (npm or yarn also work) |
| pip | latest | Python package manager |
| ngrok | latest | *Optional* — expose the app over HTTPS for phone camera access |

---

## Configuration Reference

### API Server — `skillforge-api/.env`

Copy from the template to get started:

```bash
cd skillforge-api
cp .env.example .env
```

#### Required

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key. Used for step extraction, copilot chat, vision fallback, and completion checking. Get one at [console.anthropic.com](https://console.anthropic.com) |
| `DATABASE_URL` | Neon PostgreSQL connection string. Format: `postgresql://user:password@host/dbname?sslmode=require`. Falls back to local SQLite if unset, but Neon is recommended. Get a free database at [neon.tech](https://neon.tech) |

#### Recommended

| Variable | Default | Description |
|---|---|---|
| `NVIDIA_NIM_API_KEY` | — | NVIDIA NIM API key for Nemotron VL frame analysis. Falls back to Claude Vision if unset. Get one at [build.nvidia.com](https://build.nvidia.com) |

#### Server Settings

| Variable | Default | Description |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins for CORS. Add your ngrok URL here if using phone camera access |
| `UPLOAD_DIR` | `uploads` | Local directory for uploaded videos and extracted frames |

#### Optional ML Inference Servers

These are self-hosted inference endpoints. Without them the system degrades gracefully — Claude Vision handles detection, and segmentation is skipped.

| Variable | Default | Service | Expected Endpoint |
|---|---|---|---|
| `SAM3_URL` | `http://localhost:8090` | SAM 3 concept segmentation | `POST /segment` |
| `NEMOTRON_URL` | `http://localhost:8092` | Nemotron Nano 12B VL (self-hosted, OpenAI-compatible) | `POST /v1/chat/completions` |
| `ASR_URL` | `http://localhost:8091/transcribe` | NVIDIA NIM Parakeet CTC 1.1B (self-hosted ASR) | `POST /transcribe` |
| `GROUNDING_DINO_URL` | — | Grounding DINO 1.5 open-vocab detection | `POST /predict` |
| `SAM2_URL` | — | SAM 2 object segmentation | `POST /segment` |

#### Minimal `.env` (everything else uses fallbacks)

```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-your-endpoint.region.aws.neon.tech/neondb?sslmode=require
```

---

### Frontend — `skillforge/.env.local`

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL for the FastAPI API server |
| `NEXT_PUBLIC_APP_URL` | — | Public app URL. Set this to your ngrok HTTPS URL when using phone camera access |
| `NEXT_PUBLIC_WS_HOST` | *(derived from API URL)* | WebSocket host override. Set to the ngrok hostname (without protocol) for phone camera access |

#### Minimal `.env.local` (local development)

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

#### Phone camera `.env.local` (with ngrok)

```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_URL=https://your-ngrok-host.ngrok-free.dev
NEXT_PUBLIC_WS_HOST=your-ngrok-host.ngrok-free.dev
```

---

### Frontend — `skillforge/.env`

Server-side environment variables for Next.js API routes and server components. These are NOT exposed to the browser.

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (used by server-side Next.js code) |
| `DATABASE_URL` | Neon PostgreSQL connection string (used by server-side Next.js code) |

---

### AR WebSocket Server — `skillforge/backend/`

The AR server reads environment variables directly (no `.env` file).

| Variable | Default | Description |
|---|---|---|
| `MEDIAPIPE_DELEGATE` | *(auto — try GPU, fall back to CPU)* | Set to `cpu` to force CPU, `gpu` to require GPU |

---

### Next.js Config — `skillforge/next.config.ts`

Key settings in `next.config.ts` that affect connectivity:

- **`allowedDevOrigins`** — Add your ngrok URL here if the dev server rejects requests from the ngrok origin.
- **Rewrites** — `/api/python/*` proxies to `http://localhost:8000/api/*` and `/ws/*` proxies to `http://localhost:8000/ws/*`.
- **Images** — Remote patterns allow loading images from `localhost:8000/uploads/**`.

If your API server runs on a different host/port, update the rewrite destinations and image remote patterns.

---

### ngrok Config — `ngrok.yml`

Located at the repo root. Used for the two-tunnel phone camera setup:

```yaml
version: "2"
tunnels:
  app:
    addr: 3000
    proto: http
  ar:
    addr: 8001
    proto: http
```

Run with: `ngrok start --all --config ngrok.yml`

Set `NGROK_AUTHTOKEN` in your environment or add `authtoken: YOUR_TOKEN` to the file.

---

## Quick Start

### 1. Set up the database

1. Create a free Neon PostgreSQL project at [neon.tech](https://neon.tech).
2. Copy the connection string from the Neon dashboard.
3. Tables are created automatically on first startup — no migrations needed.

### 2. Start the API server

```bash
cd skillforge-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` — at minimum set `ANTHROPIC_API_KEY` and `DATABASE_URL`:

```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-your-endpoint.region.aws.neon.tech/neondb?sslmode=require
```

Start the server:

```bash
uvicorn main:app --reload --port 8000 --ws wsproto
```

> The `--ws wsproto` flag is required. Without it, uvicorn uses the `websockets` library whose `legacy` module is incompatible with current versions.

Verify at [http://localhost:8000/docs](http://localhost:8000/docs) (interactive API docs).

### 3. Start the frontend

```bash
cd skillforge
pnpm install
```

Create `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the dev server:

```bash
pnpm dev
```

### 4. Open the app

Navigate to [http://localhost:3000](http://localhost:3000).

### 5. (Optional) Phone as camera via ngrok

To use your phone as a camera source, the phone needs HTTPS. Run ngrok to expose the app:

```bash
ngrok http 127.0.0.1:3000
```

Update `skillforge/.env.local`:

```
NEXT_PUBLIC_APP_URL=https://your-ngrok-host.ngrok-free.dev
NEXT_PUBLIC_WS_HOST=your-ngrok-host.ngrok-free.dev
```

Add your ngrok origin to `allowedDevOrigins` in `skillforge/next.config.ts`, then restart the Next.js dev server.

Full details: [Phone as camera (ngrok)](docs/phone-camera-ngrok.md)

### 6. (Optional) AR WebSocket server

For real-time hand tracking with cross-frame tracking (VIDEO mode):

```bash
cd skillforge/backend

# Download the hand landmarker model (one-time)
mkdir -p models
curl -L -o models/hand_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

# Install and run
pip install fastapi uvicorn opencv-python-headless mediapipe numpy
uvicorn main:app --host 0.0.0.0 --port 8001
```

### 7. (Optional) GPU inference services

SkillForge uses three GPU-accelerated services running on a shared NVIDIA Brev instance: **SAM 3** (segmentation), **Parakeet** (speech recognition), and **Nemotron VL** (frame analysis).

Port-forward all three to your local machine:

```bash
brev port-forward sam3-server -p 8090:8080   # SAM 3
brev port-forward sam3-server -p 8091:8081   # Parakeet (ASR)
brev port-forward sam3-server -p 8092:8082   # Nemotron VL
```

Then set the URLs in `skillforge-api/.env`:

```
SAM3_URL=http://localhost:8090
ASR_URL=http://localhost:8091/transcribe
NEMOTRON_URL=http://localhost:8092
```

Restart the API server after updating `.env`. Full details: [GPU Services Setup](docs/gpu-services-setup.md).

---

## Port Summary

| Service | Port | Protocol |
|---|---|---|
| Next.js frontend | 3000 | HTTP |
| FastAPI API server | 8000 | HTTP + WebSocket |
| AR WebSocket server | 8001 | HTTP + WebSocket |
| SAM 3 GPU server (remote) | 8080 | HTTP |
| SAM 3 (local port-forward) | 8090 | HTTP |
| ASR / Parakeet (local port-forward) | 8091 | HTTP |
| Nemotron VL (local port-forward) | 8092 | HTTP |

---

## Fallback Behavior

SkillForge is designed to be fully functional with only an `ANTHROPIC_API_KEY` and a `DATABASE_URL`, making it straightforward to run locally without extra cloud infrastructure.

| Component | Primary | Fallback |
|---|---|---|
| Frame analysis | NVIDIA Nemotron VL | Claude Vision |
| Object detection | Grounding DINO 1.5 | Claude Vision |
| Segmentation | SAM 3 / SAM 2 | Skipped |
| Database | Neon PostgreSQL | Local SQLite |
| Speech recognition | NVIDIA NIM Parakeet | Browser Web Speech API |
| File storage | Local `uploads/` | — |

---

## Workflows

### Expert Recording Flow

1. Expert navigates to `/record` and selects a recording mode.
2. Expert enters a title and description, then records via webcam with voice narration at `/record/session`.
3. Steps are captured using "Next Step" (button, voice command, or Spider-Man hand gesture).
4. On finish, the AI pipeline runs: frame extraction, Nemotron VL analysis, MediaPipe hand tracking, Claude step decomposition.
5. Expert lands in the workflow editor at `/editor/[id]` to refine steps, add annotations, and publish.

### Trainee Learning Flow

1. Trainee browses the library at `/library` and opens a workflow at `/learn/[id]`.
2. Trainee watches the video with AI-drawn overlays and uses the built-in Claude copilot chat for real-time guidance.

### Live Camera Detection

1. Navigate to `/live`.
2. Enable the camera.
3. Toggle individual detectors: Hand Tracking (MediaPipe), SAM 3 Concept Segmentation, or Custom Prompt (Grounding DINO with Claude fallback).
4. Real-time overlays are drawn directly on the camera feed.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `uvicorn` WebSocket errors | Make sure you pass `--ws wsproto` when starting the API server |
| Next.js blocks ngrok origin | Add the ngrok URL to `allowedDevOrigins` in `skillforge/next.config.ts` |
| `ERR_NGROK_8012` (connection refused) | Use `ngrok http 127.0.0.1:3000` instead of `ngrok http 3000` to avoid IPv6 issues |
| Phone camera won't connect | Ensure `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_WS_HOST` are set and the Next.js server was restarted |
| Database connection fails | Verify `DATABASE_URL` includes `?sslmode=require` for Neon. The system falls back to local SQLite if unset |
| SAM 3 features missing | `SAM3_URL` is not set or the remote server is unreachable. SAM 3 is silently skipped when unavailable |
| GPU services `Connection refused` | Port forwards are not running. Re-run `brev port-forward` for each service — see [GPU Services Setup](docs/gpu-services-setup.md) |
| MediaPipe GPU errors | Set `MEDIAPIPE_DELEGATE=cpu` to force CPU mode (default on macOS) |
| ngrok free tier URL changes | Update `.env.local` and `allowedDevOrigins` in `next.config.ts`, then restart Next.js |

---

## Documentation

| Guide | Description |
|---|---|
| [API Server Setup](docs/api-server-setup.md) | Running the FastAPI backend, database, storage, endpoints, and pipeline architecture |
| [Frontend Setup](docs/frontend-setup.md) | Running the Next.js app, routes, and frontend-backend connectivity |
| [AR WebSocket Server](docs/ar-websocket-server.md) | Running the dedicated hand tracking WebSocket server |
| [GPU Services Setup](docs/gpu-services-setup.md) | Connecting to SAM 3, Parakeet, and Nemotron VL on the Brev GPU instance |
| [SAM 3 GPU Deployment](docs/sam3-gpu-deployment.md) | Deploying the SAM 3 inference server on NVIDIA Brev |
| [Environment Variables](docs/environment-variables.md) | Consolidated reference for every env var across all services |
| [Phone as camera (ngrok)](docs/phone-camera-ngrok.md) | Using your phone as a camera source over HTTPS |

---

## License

This project is for internal and educational use. See individual service documentation for third-party licensing terms (Meta SAM 2/3, Grounding DINO, NVIDIA NIM, Anthropic Claude).
