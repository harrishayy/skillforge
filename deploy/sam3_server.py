"""
SAM 3 inference server for deployment on NVIDIA Brev (GPU instance).

Exposes a FastAPI HTTP API that SkillForge's backend calls to run
promptable concept segmentation on camera frames.

Multi-worker architecture: loads N independent (model, processor) pairs
on the same GPU using an asyncio.Queue as a worker pool. Each request
acquires a worker, runs inference in a thread (non-blocking), and
returns the worker to the pool. With ~5 GB per instance and 74 GB free
on an A100, 4-6 workers fit comfortably.

Setup on Brev:
    conda create -n sam3 python=3.12 -y && conda activate sam3
    pip install torch==2.7.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
    git clone https://github.com/facebookresearch/sam3.git && cd sam3 && pip install -e .
    pip install fastapi uvicorn python-multipart
    huggingface-cli login  # checkpoints are gated

Run:
    uvicorn sam3_server:app --host 0.0.0.0 --port 8080

    # Override worker count via env var (default 4):
    SAM3_WORKERS=6 uvicorn sam3_server:app --host 0.0.0.0 --port 8080
"""

import io
import os
import base64
import time
import asyncio
from contextlib import asynccontextmanager

import numpy as np
import torch
from PIL import Image
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

SAM3_WORKERS = int(os.environ.get("SAM3_WORKERS", "4"))

_worker_queue: asyncio.Queue | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker_queue
    _worker_queue = asyncio.Queue()

    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    print(f"[SAM3] Loading {SAM3_WORKERS} model instance(s) on {device_name} …")

    for i in range(SAM3_WORKERS):
        model = build_sam3_image_model()
        processor = Sam3Processor(model)
        await _worker_queue.put(processor)
        vram_gb = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
        print(f"[SAM3] Worker {i + 1}/{SAM3_WORKERS} ready (VRAM: {vram_gb:.1f} GB)")

    if torch.cuda.is_available():
        total_gb = torch.cuda.get_device_properties(0).total_mem / 1e9
        used_gb = torch.cuda.memory_allocated() / 1e9
        print(f"[SAM3] All workers loaded — VRAM: {used_gb:.1f} / {total_gb:.0f} GB")

    yield


app = FastAPI(title="SAM 3 Inference Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    ready = _worker_queue is not None
    available = _worker_queue.qsize() if ready else 0
    vram_gb = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
    return {
        "status": "ok",
        "model": "sam3",
        "ready": ready,
        "workers": SAM3_WORKERS,
        "available_workers": available,
        "vram_allocated_gb": round(vram_gb, 1),
    }


def _run_inference(
    processor: Sam3Processor,
    image_bytes: bytes,
    text: str,
    box: str,
    point: str,
    label: int,
) -> dict:
    """Blocking SAM3 inference — runs in a worker thread."""
    t0 = time.perf_counter()

    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = pil_image.size
    inference_state = processor.set_image(pil_image)

    if text:
        output = processor.set_text_prompt(state=inference_state, prompt=text)
    elif point:
        coords = [float(v) for v in point.split(",")]
        point_pixels = torch.tensor([[coords[0] * w, coords[1] * h]])
        point_labels = torch.tensor([label])
        output = processor.set_point_prompt(
            state=inference_state,
            points=point_pixels,
            labels=point_labels,
        )
    elif box:
        coords = [float(v) for v in box.split(",")]
        box_pixels = [[coords[0] * w, coords[1] * h, coords[2] * w, coords[3] * h]]
        output = processor.set_box_prompt(
            state=inference_state, boxes=torch.tensor(box_pixels)
        )
    else:
        return {"error": "Provide 'text', 'point', or 'box' parameter"}

    masks = output["masks"]    # [N, 1, H, W]
    boxes_out = output["boxes"]  # [N, 4]
    scores = output["scores"]  # [N]

    encoded_masks: list[str] = []
    for mask in masks:
        mask_np = (mask.squeeze().cpu().numpy() * 255).astype(np.uint8)
        mask_img = Image.fromarray(mask_np)
        buf = io.BytesIO()
        mask_img.save(buf, format="PNG")
        encoded_masks.append(base64.b64encode(buf.getvalue()).decode())

    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    norm_boxes = []
    for b in boxes_out.cpu().tolist():
        norm_boxes.append([b[0] / w, b[1] / h, b[2] / w, b[3] / h])

    return {
        "masks": encoded_masks,
        "boxes": norm_boxes,
        "scores": scores.cpu().tolist(),
        "processing_ms": elapsed_ms,
    }


@app.post("/segment")
async def segment(
    image: UploadFile = File(...),
    text: str = Form(default=""),
    box: str = Form(default=""),
    point: str = Form(default=""),
    label: int = Form(default=1),
):
    """
    Segment objects in an image using SAM 3.

    Accepts one of:
      - text:  concept prompt (e.g. "yellow school bus")
      - box:   normalized coords "x1,y1,x2,y2" for box-prompted segmentation
      - point: normalized coords "x,y" for click-to-segment
               label=1 (foreground, default) or label=0 (background)

    Returns JSON: { masks: [base64-png, …], boxes: [[x1,y1,x2,y2], …], scores: [float, …] }
    """
    if _worker_queue is None:
        return {"error": "Model not loaded yet"}

    image_bytes = await image.read()

    processor = await _worker_queue.get()
    try:
        result = await asyncio.to_thread(
            _run_inference, processor, image_bytes, text, box, point, label,
        )
        return result
    finally:
        await _worker_queue.put(processor)
