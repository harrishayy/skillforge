"""
SAM 3 inference server for deployment on NVIDIA Brev (GPU instance).

Exposes a FastAPI HTTP API that SkillForge's backend calls to run
promptable concept segmentation on camera frames.

Setup on Brev:
    conda create -n sam3 python=3.12 -y && conda activate sam3
    pip install torch==2.7.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
    git clone https://github.com/facebookresearch/sam3.git && cd sam3 && pip install -e .
    pip install fastapi uvicorn python-multipart
    huggingface-cli login  # checkpoints are gated

Run:
    uvicorn sam3_server:app --host 0.0.0.0 --port 8080
"""

import io
import base64
import time
from contextlib import asynccontextmanager

import numpy as np
import torch
from PIL import Image
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

_model = None
_processor: Sam3Processor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model, _processor
    print("[SAM3] Loading model …")
    _model = build_sam3_image_model()
    _processor = Sam3Processor(_model)
    print("[SAM3] Model loaded and ready")
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
    return {"status": "ok", "model": "sam3", "ready": _processor is not None}


@app.post("/segment")
async def segment(
    image: UploadFile = File(...),
    text: str = Form(default=""),
    box: str = Form(default=""),
):
    """
    Segment objects in an image using SAM 3.

    Accepts either:
      - text: concept prompt (e.g. "yellow school bus")
      - box:  normalized coords "x1,y1,x2,y2" for interactive segmentation

    Returns JSON: { masks: [base64-png, …], boxes: [[x1,y1,x2,y2], …], scores: [float, …] }
    """
    if _processor is None:
        return {"error": "Model not loaded yet"}

    t0 = time.perf_counter()

    image_bytes = await image.read()
    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    inference_state = _processor.set_image(pil_image)

    if text:
        output = _processor.set_text_prompt(state=inference_state, prompt=text)
    elif box:
        coords = [float(v) for v in box.split(",")]
        w, h = pil_image.size
        box_pixels = [[coords[0] * w, coords[1] * h, coords[2] * w, coords[3] * h]]
        output = _processor.set_box_prompt(
            state=inference_state, boxes=torch.tensor(box_pixels)
        )
    else:
        return {"error": "Provide either 'text' or 'box' parameter"}

    masks = output["masks"]    # [N, 1, H, W]
    boxes = output["boxes"]    # [N, 4]
    scores = output["scores"]  # [N]

    encoded_masks: list[str] = []
    for mask in masks:
        mask_np = (mask.squeeze().cpu().numpy() * 255).astype(np.uint8)
        mask_img = Image.fromarray(mask_np)
        buf = io.BytesIO()
        mask_img.save(buf, format="PNG")
        encoded_masks.append(base64.b64encode(buf.getvalue()).decode())

    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    # Normalize boxes back to 0-1 range relative to image dimensions
    w, h = pil_image.size
    norm_boxes = []
    for b in boxes.cpu().tolist():
        norm_boxes.append([b[0] / w, b[1] / h, b[2] / w, b[3] / h])

    return {
        "masks": encoded_masks,
        "boxes": norm_boxes,
        "scores": scores.cpu().tolist(),
        "processing_ms": elapsed_ms,
    }
