# SkillForge

An AI-powered knowledge transfer platform that bridges the gap between expert practitioners and trainees — across both digital software workflows and hands-on physical tasks.

---

## Overview

SkillForge lets experts record what they know, and lets AI turn those recordings into structured, interactive learning experiences for trainees. It supports three distinct modes:

**Digital Workflow** — Experts screen-record themselves performing software tasks. An AI pipeline (NVIDIA Nemotron VL + Claude) extracts steps, identifies UI elements, and generates annotations. Trainees replay recordings with live visual overlays and a built-in Claude copilot.

**Physical Apprenticeship** — Experts record video of physical demonstrations. Optical flow isolates key frames, Claude Vision extracts structured steps, and during a trainee session MediaPipe, YOLOv8, and Grounding DINO deliver real-time AR-style overlays.

**Live Camera Detection** — A standalone mode with no workflow required. Point a camera, toggle detectors (hand tracking, YOLO objects, SAM 3 concept segmentation), and see real-time overlays on the camera feed.

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

| Component | Description | Required |
|---|---|---|
| **Frontend** | Next.js 16 / React 19 web app | Yes |
| **API Server** | FastAPI backend — pipelines, detection, storage, copilot | Yes |
| **AR WebSocket Server** | Dedicated FastAPI process for real-time hand tracking over WebSocket | Optional |
| **SAM 3 GPU Server** | Remote inference server for concept segmentation, deployed on NVIDIA Brev | Optional |

---

## Tech Stack

- **Frontend** — Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zustand, Fabric.js, Framer Motion
- **Backend** — Python FastAPI, uvicorn, Neon PostgreSQL (asyncpg), SQLite fallback
- **AI / ML** — Claude Sonnet (Anthropic), Nemotron VL (NVIDIA NIM), MediaPipe Hands, YOLOv8n, Grounding DINO 1.5, SAM 2/3, DINOv2
- **Real-time** — WebSockets for pipeline progress, live sessions, and AR hand tracking

---

## Project Structure

```
skillforge/
├── skillforge/                  # Next.js frontend
│   ├── app/                     # App Router pages
│   │   ├── (expert)/            # Expert routes: /record, /workflows, /editor/[id]
│   │   ├── (trainee)/           # Trainee routes: /library, /learn/[id]
│   │   ├── (physical)/          # Physical routes: /tasks, /capture, /guide/[id]
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

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- `pip` and `pnpm` (or `npm`)

### 1. Start the API server

```bash
cd skillforge-api
pip install -r requirements.txt
cp .env.example .env          # edit with your API keys
uvicorn main:app --reload --port 8000
```

Full details: [API Server Setup](docs/api-server-setup.md)

### 2. Start the frontend

```bash
cd skillforge
pnpm install
pnpm dev
```

Full details: [Frontend Setup](docs/frontend-setup.md)

### 3. Open the app

Navigate to [http://localhost:3000](http://localhost:3000).

### Optional components

- **AR WebSocket Server** — real-time hand tracking over WebSocket. See [AR WebSocket Server](docs/ar-websocket-server.md).
- **SAM 3 GPU Server** — concept segmentation on NVIDIA Brev. See [SAM 3 GPU Deployment](docs/sam3-gpu-deployment.md).

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
3. Toggle individual detectors: Hand Tracking (MediaPipe), YOLO Objects, SAM 3 Concept Segmentation, or Custom Prompt (Grounding DINO with Claude fallback).
4. Real-time overlays are drawn directly on the camera feed.

---

## Fallback Behavior

SkillForge is designed to be fully functional with only an `ANTHROPIC_API_KEY`, making it straightforward to run locally without any cloud infrastructure.

| Component | Primary | Fallback |
|---|---|---|
| Frame analysis | NVIDIA Nemotron VL | Claude Vision |
| Object detection | Grounding DINO 1.5 | Claude Vision |
| Segmentation | SAM 3 / SAM 2 | Skipped |
| Feature extraction | DINOv2 | Skipped |
| Database | Neon PostgreSQL | Local SQLite |
| File storage | Local `uploads/` | — |

---

## Documentation

| Guide | Description |
|---|---|
| [API Server Setup](docs/api-server-setup.md) | Running the FastAPI backend, database, storage, endpoints, and pipeline architecture |
| [Frontend Setup](docs/frontend-setup.md) | Running the Next.js app, routes, and frontend-backend connectivity |
| [AR WebSocket Server](docs/ar-websocket-server.md) | Running the dedicated hand tracking WebSocket server |
| [SAM 3 GPU Deployment](docs/sam3-gpu-deployment.md) | Deploying the SAM 3 inference server on NVIDIA Brev |
| [Environment Variables](docs/environment-variables.md) | Consolidated reference for every env var across all services |

---

## License

This project is for internal and educational use. See individual service documentation for third-party licensing terms (Ultralytics YOLOv8, Meta SAM 2/3, Grounding DINO, DINOv2, NVIDIA NIM, Anthropic Claude).
