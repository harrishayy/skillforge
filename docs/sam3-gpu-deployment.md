# SAM 3 GPU Deployment

Deploy the SAM 3 concept segmentation inference server on an NVIDIA Brev GPU instance. This server enables text-prompted and box-prompted segmentation in SkillForge's live detection pipeline.

Located at `deploy/sam3_server.py`.

---

## What SAM 3 Does in SkillForge

SAM 3 (Segment Anything Model 3) performs **concept segmentation** — given an image and a text prompt like "yellow school bus", it returns pixel-level masks, bounding boxes, and confidence scores for all matching objects.

In the live detection page (`/live`), users can type a text prompt and SAM 3 segments matching objects in real time on the camera feed. The frontend sends frames to the API server, which forwards them to this remote GPU server.

```
Browser  →  API Server (/api/live/detect-frame)  →  SAM 3 Server (/segment)  →  masks + boxes
```

If `SAM3_URL` is not set in the API server's `.env`, SAM 3 features are silently skipped.

---

## Prerequisites

- NVIDIA Brev account ([brev.nvidia.com](https://brev.nvidia.com))
- Hugging Face account with access to [facebook/sam3](https://huggingface.co/facebook/sam3) (model checkpoints are gated)

---

## 1. Create a Brev Instance

1. Log in at [brev.nvidia.com](https://brev.nvidia.com).
2. **Create New Instance** with an A100 40GB, A10G, or L4 GPU.
3. Name it `sam3-server` and deploy.

---

## 2. Connect to the Instance

```bash
# Install the Brev CLI (macOS)
brew install brevdev/homebrew-brev/brev

brev login
brev shell sam3-server
```

---

## 3. Install Dependencies

```bash
conda create -n sam3 python=3.12 -y
conda activate sam3

pip install torch==2.7.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
git clone https://github.com/facebookresearch/sam3.git && cd sam3 && pip install -e .
pip install fastapi uvicorn python-multipart huggingface_hub

huggingface-cli login
```

The `huggingface-cli login` step is required because the SAM 3 model checkpoints are gated on Hugging Face.

---

## 4. Deploy the Server

Copy `deploy/sam3_server.py` from this repository to the Brev instance, then:

```bash
uvicorn sam3_server:app --host 0.0.0.0 --port 8080
```

The model loads at startup (may take 30–60 seconds depending on the GPU).

---

## 5. Expose the Port

In the Brev Console under **Instance Details > Access**, expose port **8080**. You'll get a public URL like:

```
https://sam3-server-8080-xxxx.brev.dev
```

Test it:

```bash
curl https://sam3-server-8080-xxxx.brev.dev/health
# → {"status": "ok", "model": "sam3", "ready": true}
```

---

## 6. Connect to SkillForge

Set `SAM3_URL` in `skillforge-api/.env`:

```
SAM3_URL=https://sam3-server-8080-xxxx.brev.dev
```

Restart the API server. The SAM 3 service will log `[SAM3] Configured → https://...` on the first request.

---

## API Reference

### `GET /health`

Returns server status:

```json
{ "status": "ok", "model": "sam3", "ready": true }
```

### `POST /segment`

Segment objects in an image. Accepts multipart form data.

**Text prompt (concept segmentation):**

| Field | Type | Description |
|---|---|---|
| `image` | file | JPEG or PNG image |
| `text` | string | Concept prompt, e.g. "yellow school bus" |

**Box prompt (interactive segmentation):**

| Field | Type | Description |
|---|---|---|
| `image` | file | JPEG or PNG image |
| `box` | string | Normalized coordinates `"x1,y1,x2,y2"` (0–1 range) |

**Response:**

```json
{
  "masks": ["<base64-encoded PNG>", ...],
  "boxes": [[0.1, 0.2, 0.5, 0.6], ...],
  "scores": [0.95, ...],
  "processing_ms": 142
}
```

- `masks` — Base64-encoded grayscale PNG masks, one per detected object.
- `boxes` — Normalized bounding boxes `[x1, y1, x2, y2]` in 0–1 range.
- `scores` — Confidence scores for each detection.

---

## Keeping the Server Running

Use `tmux` so the server persists after disconnecting:

```bash
tmux new -s sam3
conda activate sam3
uvicorn sam3_server:app --host 0.0.0.0 --port 8080
# Ctrl+B, D to detach
```

Reattach later with `tmux attach -t sam3`.

---

## Cost Management

Brev charges for running instances. Stop the instance when not in use:

```bash
brev stop sam3-server    # stop billing
brev start sam3-server   # resume later
```

The exposed URL remains the same after restart, so you don't need to update `SAM3_URL`.
