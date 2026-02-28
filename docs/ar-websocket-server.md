# AR WebSocket Server

A dedicated FastAPI process for real-time hand detection over WebSocket. This runs separately from the main API server and is optimized for low-latency, frame-by-frame MediaPipe inference with cross-frame tracking (VIDEO mode).

Located at `skillforge/backend/`.

---

## What It Does

- **`/ws/live/detect`** — Accepts camera frames over WebSocket, runs MediaPipe Hand Landmarker in VIDEO mode (with tracking across frames), and returns hand landmarks + fingertip pointing coordinates.
- **`/ws/ar`** — AR camera stream endpoint. Currently returns a placeholder pose matrix; reserved for future PnP/ArUco-based pose estimation.
- **`/api/live/detect-frame`** — HTTP POST endpoint for single-frame hand detection (IMAGE mode, no cross-frame tracking).

The main API server (`skillforge-api/`) also has a `/api/live/detect-frame` endpoint. This AR server is an alternative that adds WebSocket-based streaming and VIDEO mode tracking for smoother real-time detection.

---

## Prerequisites

- Python 3.10+
- `uv` (recommended) or `pip`

---

## Hand Landmarker Model

The server requires `models/hand_landmarker.task`. Download it before first run:

```bash
cd skillforge/backend
mkdir -p models
curl -L -o models/hand_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
```

---

## Running

```bash
cd skillforge/backend

# Using uv (recommended)
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8001

# Using pip
pip install fastapi uvicorn opencv-python-headless mediapipe numpy
uvicorn main:app --host 0.0.0.0 --port 8001
```

Run on a different port than the main API server (default 8000). The frontend expects this server on port 8001 by default.

For using your phone as a camera source ("Use phone as camera" on `/live`), the phone needs HTTPS/WSS. Use [ngrok](phone-camera-ngrok.md) to expose this server and the Next.js app; run this backend with plain HTTP above and start the ngrok tunnels from the repo root.

---

## GPU vs CPU Delegate

MediaPipe Hand Landmarker can use a GPU delegate for faster inference. The server tries GPU first and falls back to CPU automatically.

| `MEDIAPIPE_DELEGATE` | Behavior |
|---|---|
| *(unset)* | Try GPU, fall back to CPU |
| `cpu` | Force CPU only |
| `gpu` | Force GPU, error if unavailable |

GPU is typically supported on Linux with appropriate NVIDIA drivers. On macOS, CPU is used.

```bash
export MEDIAPIPE_DELEGATE=cpu
uvicorn main:app --host 0.0.0.0 --port 8001
```

---

## WebSocket Protocol

### `/ws/live/detect` — Live Hand Detection

**Client sends:**

```json
{
  "type": "frame",
  "data": "<base64-encoded JPEG>",
  "timestamp_ms": 1234567890
}
```

**Server responds:**

```json
{
  "hands": {
    "hand_count": 1,
    "hands": [{ "landmarks": [{"x": 42.5, "y": 31.2}, ...] }],
    "pointing_at": { "x": 42.5, "y": 31.2 }
  },
  "sam3_segments": [],
  "processing_ms": 12
}
```

Landmarks are in 0–100 scale (percentage of frame dimensions). The server uses a "process latest" strategy — if a new frame arrives while the previous is still processing, only the latest frame is queued, keeping latency low.

### `/ws/ar` — AR Camera Stream

**Client sends:**

```json
{
  "type": "frame",
  "data": "<base64-encoded JPEG>"
}
```

**Server responds:**

```json
{
  "type": "pose",
  "view_matrix": [1, 0, 0, 0, ...],
  "projection_matrix": [1, 0, 0, 0, ...]
}
```

Currently returns identity matrices as a placeholder. This endpoint is reserved for future 6DoF pose estimation.
