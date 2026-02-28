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

- Python 3.11+
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

### Running over HTTPS (WSS) for phone camera

Mobile browsers often require a secure context (HTTPS) for camera access. When the Next.js app is served over HTTPS, the frontend uses **WSS** to connect to this server. If the server only accepts plain WS, you will see "Invalid HTTP request received" in the server log and the camera feed will not reach the viewer.

**Option A — Use Next.js dev certs (simplest):** After running `npm run dev:https` once in `skillforge/`, certs are created in `skillforge/certificates/`. Run the AR server with SSL:

```bash
cd skillforge/backend
uv run python run_https.py
```

Or explicitly:

```bash
uv run uvicorn main:app --host 0.0.0.0 --port 8001 --ssl-keyfile=../certificates/localhost-key.pem --ssl-certfile=../certificates/localhost.pem
```

**Option B — Generate your own certs** (e.g. to match your LAN IP in the cert):

1. Generate a self-signed certificate (e.g. in `skillforge/backend`):

   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
   ```

   For LAN access you can use your machine's IP: `-subj "/CN=192.168.1.5"` (replace with your LAN IP). The phone will show a certificate warning; accept it once.

2. Run the server with SSL:

   ```bash
   uv run uvicorn main:app --host 0.0.0.0 --port 8001 --ssl-keyfile=key.pem --ssl-certfile=cert.pem
   ```

3. Set `NEXT_PUBLIC_APP_URL=https://<LAN-IP>:3000` and `NEXT_PUBLIC_WS_HOST=<LAN-IP>:8001` in the Next.js app's `.env.local`. The frontend will use `wss://` for the camera room when the app URL is HTTPS.

4. Ensure your firewall allows inbound connections on port 8001.

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
