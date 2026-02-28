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

---

## Routes

| Path | Area | Description |
|---|---|---|
| `/` | Home | Landing page with role selection |
| `/record` | Recording | Mode selection (software / hardware) |
| `/record/setup` | Recording | Title and description entry before recording |
| `/record/session` | Recording | Live webcam recording session with voice commands |
| `/workflows` | Expert | List of expert workflows |
| `/editor/[workflowId]` | Expert | Annotation and step editor |
| `/library` | Trainee | Browse available workflows |
| `/learn/[workflowId]` | Trainee | Interactive learning view with overlays and copilot |
| `/live` | Live | Standalone camera detection (no workflow needed) |

---

## Project Structure

```
skillforge/
├── app/                         # Next.js App Router
│   ├── (expert)/                # Expert route group
│   │   ├── editor/[workflowId]/ # Workflow annotation editor
│   │   └── workflows/           # Workflow list
│   ├── (trainee)/               # Trainee route group
│   │   ├── learn/[workflowId]/  # Interactive learning
│   │   └── library/             # Workflow browser
│   ├── record/                  # Recording flow
│   │   ├── (select)/            # Mode selection
│   │   └── (expert)/            # Setup + live recording session
│   ├── live/                    # Live camera detection
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
│   ├── recording/               # Recording controls and pipeline status
│   ├── recording-session/       # Session UI (control bar, step history, toolbar)
│   ├── shared/                  # Reusable components
│   └── ui/                      # Primitives (buttons, inputs, etc.)
├── hooks/                       # React hooks
│   ├── useWebcamRecorder.ts     # Webcam recording with snapshot/pause/resume
│   ├── useScreenRecorder.ts     # Screen recording
│   ├── useVoiceCommands.ts      # Speech recognition voice commands
│   ├── useMediaPipeDetect.ts    # On-device MediaPipe detection
│   ├── useLiveDetect.ts         # WebSocket live detection
│   ├── useSam3Detect.ts         # HTTP SAM 3 segmentation
│   ├── useARStream.ts           # AR pipeline WebSocket
│   ├── useCopilotChat.ts        # Claude copilot chat
│   ├── useCameraStream.ts       # Camera stream management
│   └── useWorkflowSocket.ts     # Pipeline progress WebSocket
├── lib/                         # Utilities
│   ├── api-client.ts            # API client functions
│   ├── constants.ts             # API and WebSocket URL definitions
│   └── ...                      # Helpers and utilities
├── store/                       # Zustand state stores
│   ├── workflow-store.ts        # Workflow and editor state
│   ├── player-store.ts          # Video player state
│   └── toast-store.ts           # Error toast notifications
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
| `/ws/live/detect` | AR Server (8001) | Real-time hand detection in VIDEO mode |
| `/ws/ar` | AR Server (8001) | AR camera stream (phone to laptop) |

### Detection Modes

The live detection page (`/live`) supports a hybrid approach:

- **MediaPipe** runs on-device in the browser via `@mediapipe/tasks-vision` — no backend call needed.
- **SAM 3** sends frames to the API server via HTTP (`/api/live/detect-frame`), which forwards to the remote SAM 3 GPU server.
- **Custom** sends frames to the API server via HTTP for Grounding DINO or Claude-based detection.
- **Hand tracking over WebSocket** sends frames to the AR WebSocket server for MediaPipe VIDEO mode with cross-frame tracking.
