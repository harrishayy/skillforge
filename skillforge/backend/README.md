# Backend (FastAPI)

- **AR WebSocket**: `GET /ws/ar` — receive frames, return pose/ack.
- **Live detect**: `POST /api/live/detect-frame` — MediaPipe Hand Landmarker for hand detection.

**GPU acceleration**: Hand detection uses GPU when available (MediaPipe GPU delegate). If GPU init fails, it falls back to CPU. Set `MEDIAPIPE_DELEGATE=cpu` to force CPU; set `MEDIAPIPE_DELEGATE=gpu` to fail fast if GPU is unavailable. GPU is typically supported on Linux with appropriate drivers.

## Hand detection model

The Hand Landmarker requires `models/hand_landmarker.task`. If missing, download it:

```bash
curl -L -o models/hand_landmarker.task "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
```

## Run

```bash
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```
