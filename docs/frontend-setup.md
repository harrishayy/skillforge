# Frontend Setup

Next.js web application for SkillForge. Provides the expert recording interface, trainee learning views, workflow editor, and live camera detection page.

---

## Prerequisites

- Node.js 18+
- `pnpm` (recommended), `npm`, or `yarn`

---

## Installation

```bash
cd skillforge
pnpm install
```

---

## Environment

Create a `.env.local` file (or copy from the example if one exists):

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:8000` | Base URL for the FastAPI API server |
| `NEXT_PUBLIC_WS_HOST` | No | Derived from API URL | WebSocket host override |

If you leave these unset, the frontend defaults to `localhost:8000` for the backend.

---

## Running

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Other commands:

```bash
pnpm build        # production build
pnpm start        # serve production build
pnpm lint         # run ESLint
```

---

## Key Technologies

| Technology | Version | Role |
|---|---|---|
| Next.js | 16 | App Router framework |
| React | 19 | UI library |
| TypeScript | 5 | Type safety |
| Tailwind CSS | 4 | Styling |
| Zustand | 5 | Global state management |
| Fabric.js | 6 | Canvas-based annotation editor |
| Framer Motion | 11 | Animations and transitions |
| MediaPipe Tasks Vision | 0.10 | On-device hand tracking |
| Socket.io Client | 4 | Real-time communication |
| React DnD | 16 | Drag and drop in the editor |

---

## Routes

| Path | Area | Description |
|---|---|---|
| `/` | Home | Landing page with role selection |
| `/record` | Expert | Screen / webcam recording interface |
| `/workflows` | Expert | List of expert workflows |
| `/editor/[workflowId]` | Expert | Annotation and step editor |
| `/library` | Trainee | Browse available workflows |
| `/learn/[workflowId]` | Trainee | Interactive learning view with overlays and copilot |
| `/tasks` | Physical | Browse physical apprenticeship tasks |
| `/capture` | Physical | Upload physical demonstration video |
| `/guide/[id]` | Physical | Live guided session with AR overlays |
| `/live` | Live | Standalone camera detection (no workflow needed) |

---

## Project Structure

```
skillforge/
├── app/                         # Next.js App Router
│   ├── (expert)/                # Expert route group
│   │   ├── editor/[workflowId]/ # Workflow annotation editor
│   │   ├── record/              # Recording interface
│   │   └── workflows/           # Workflow list
│   ├── (trainee)/               # Trainee route group
│   │   ├── learn/[workflowId]/  # Interactive learning
│   │   └── library/             # Workflow browser
│   ├── (physical)/              # Physical apprenticeship routes
│   ├── live/                    # Live camera detection
│   ├── api/health/              # Next.js health check API route
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Home page
│   └── globals.css              # Global styles and CSS variables
├── components/                  # React components by feature
│   ├── camera/                  # Camera stream UI
│   ├── chat/                    # Copilot chat interface
│   ├── editor/                  # Workflow editor panels
│   ├── live-detect/             # Live detection sidebar and overlays
│   ├── pipeline/                # Pipeline progress display
│   ├── player/                  # Video player with annotations
│   ├── recording/               # Recording controls
│   ├── shared/                  # Reusable components
│   └── ui/                      # Primitives (buttons, inputs, etc.)
├── hooks/                       # React hooks
│   ├── useCameraStream.ts       # Camera stream management
│   ├── useLiveDetect.ts         # WebSocket live detection
│   ├── useSam3Detect.ts         # HTTP SAM 3 segmentation
│   ├── useMediaPipeDetect.ts    # On-device MediaPipe detection
│   ├── useARStream.ts           # AR pipeline WebSocket
│   ├── useCopilotChat.ts        # Claude copilot chat
│   ├── useScreenRecorder.ts     # Screen recording
│   └── useMicLevel.ts           # Microphone level monitoring
├── lib/                         # Utilities
│   ├── constants.ts             # API and WebSocket URL definitions
│   └── ...                      # API clients, helpers
├── store/                       # Zustand state stores
├── types/                       # TypeScript type definitions
└── backend/                     # AR WebSocket server (separate process)
```

---

## How the Frontend Connects to Backends

### API Server (port 8000)

REST calls are made directly to the FastAPI server at the URL defined by `NEXT_PUBLIC_API_URL`. Additionally, `next.config.ts` defines a rewrite rule:

```
/api/python/*  →  http://localhost:8000/api/*
```

This allows calling backend endpoints through the Next.js server when needed.

### WebSocket Connections

The frontend opens several WebSocket connections to different backend servers:

| Endpoint | Backend | Purpose |
|---|---|---|
| `/ws/pipeline/{workflowId}` | API Server (8000) | Real-time pipeline progress events |
| `/ws/live/{sessionId}` | API Server (8000) | Live session events during guided tasks |
| `/ws/live/detect` | AR Server (8001) | Real-time hand detection in VIDEO mode |
| `/ws/ar` | AR Server (8001) | AR camera stream (phone to laptop) |

### Detection Modes

The live detection page (`/live`) supports a hybrid approach:

- **MediaPipe** runs on-device in the browser via `@mediapipe/tasks-vision` — no backend call needed.
- **SAM 3** sends frames to the API server via HTTP (`/api/live/detect-frame`), which forwards to the remote SAM 3 GPU server.
- **YOLO / Custom** send frames to the API server via HTTP for server-side inference.
- **Hand tracking over WebSocket** sends frames to the AR WebSocket server for MediaPipe VIDEO mode with cross-frame tracking.
