# GPU Services Setup

SkillForge uses three GPU-accelerated inference servers running on a shared NVIDIA Brev instance. This guide covers how to connect your local development environment to the remote GPU services via port forwarding.

For deploying the Brev instance itself, see [SAM 3 GPU Deployment](sam3-gpu-deployment.md).

---

## Services Overview

All three services run on a single Brev instance named `sam3-server`:

| Service | Model | Remote Port | Local Port | Env Variable | Used For |
|---|---|---|---|---|---|
| **SAM 3** | Meta SAM 3 | 8080 | 8090 | `SAM3_URL` | Concept segmentation from text/box prompts |
| **Parakeet** | NVIDIA Parakeet TDT 1.1B | 8081 | 8091 | `ASR_URL` | Automatic speech recognition (transcription) |
| **Nemotron VL** | NVIDIA Nemotron Nano 12B VL | 8082 | 8092 | `NEMOTRON_URL` | Vision-language object detection across video frames |

---

## Prerequisites

- [Brev CLI](https://docs.brev.dev/docs/reference/brev-cli) installed
- Authenticated with `brev login`
- The `sam3-server` Brev instance is running (`brev ls` to check)

```bash
# Install the Brev CLI (macOS)
brew install brevdev/homebrew-brev/brev

brev login
```

---

## Quick Start — Port Forward All Services

Run all three port forwards to map the remote GPU services to your local machine:

```bash
brev port-forward sam3-server -p 8090:8080   # SAM 3
brev port-forward sam3-server -p 8091:8081   # Parakeet (ASR)
brev port-forward sam3-server -p 8092:8082   # Nemotron VL
```

Each command runs in the foreground and must stay open. Use separate terminal tabs or `tmux` panes.

Then set the URLs in `skillforge-api/.env`:

```
SAM3_URL=http://localhost:8090
ASR_URL=http://localhost:8091/transcribe
NEMOTRON_URL=http://localhost:8092
```

Restart the API server after updating `.env`.

---

## Verifying the Connections

After port forwarding, confirm each service is reachable:

```bash
# SAM 3
curl http://localhost:8090/health
# → {"status": "ok", "model": "sam3", "gpu": "NVIDIA A100 80GB PCIe", ...}

# Parakeet (ASR)
curl http://localhost:8091/health
# → {"status": "ok", "model": "nvidia/parakeet-tdt-1.1b", "gpu": "NVIDIA A100 80GB PCIe", ...}

# Nemotron VL (OpenAI-compatible vLLM — no /health endpoint)
curl http://localhost:8092/v1/models
# → {"object": "list", "data": [{"id": "nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16", ...}]}
```

---

## How Each Service Is Used

### SAM 3 — Concept Segmentation

Used on the **Live Detection** page (`/live`) and in the **hardware pipeline** for key object segmentation. Given an image and a text prompt (e.g. "yellow school bus"), returns pixel-level masks and bounding boxes.

```
Browser → API Server (/api/live/detect-frame) → SAM 3 (/segment) → masks + boxes
```

Falls back to: skipped if unavailable.

### Parakeet — Speech Recognition

Used during **expert recording** (`/record/session`) to transcribe voice narration in real time. Audio chunks are sent to the Parakeet server which returns transcriptions.

```
Browser (audio chunks) → API Server (/api/asr/transcribe) → Parakeet (/transcribe) → text
```

Falls back to: browser Web Speech API, then NVIDIA NIM cloud API (requires `NVIDIA_NIM_API_KEY`).

### Nemotron VL — Frame Analysis

Used in the **hardware pipeline** after recording to scan extracted video frames for key objects. For each frame, Nemotron answers "Is this object present?" with a yes/no and explanation.

```
Pipeline → Nemotron VL (/v1/chat/completions) → object presence per frame
```

Falls back to: Claude Vision.

---

## Instance Management

```bash
# Check instance status
brev ls

# Stop the instance (stops billing)
brev stop sam3-server

# Restart the instance
brev start sam3-server

# SSH into the instance
brev shell sam3-server
```

After restarting the instance, you need to re-run the `brev port-forward` commands — tunnels do not persist across instance restarts.

---

## Remote Service Ports

On the Brev instance itself, the three servers run on these ports:

| Service | Command | Port |
|---|---|---|
| SAM 3 | `uvicorn sam3_server:app --host 0.0.0.0 --port 8080` | 8080 |
| Parakeet | NVIDIA NIM container | 8081 |
| Nemotron VL | `vllm serve nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16 --port 8082` | 8082 |

Use `tmux` on the instance to keep servers running after disconnecting.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Connection refused` on localhost port | Port forward is not running. Re-run the `brev port-forward` command for that service |
| `brev port-forward` exits immediately | Instance may be stopped. Run `brev ls` to check, then `brev start sam3-server` |
| `Address already in use` on local port | A previous tunnel is still running. Find it with `lsof -i :<port>` and kill the process |
| Nemotron returns 0 detections | Verify the tunnel with `curl http://localhost:8092/v1/models`. If it fails, the forward is down |
| `brev login` auth errors | Re-run `brev login` to refresh credentials |
| Port forwards drop after sleep/lid close | Tunnels don't survive network changes. Re-run all three `brev port-forward` commands |
