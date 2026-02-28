import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

from models.database import init_db
from services.mediapipe_tracker import load_mediapipe

from routers.workflows import router as workflows_router
from routers.recording import router as recording_router
from routers.editor import router as editor_router
from routers.pipeline import router as pipeline_router
from routers.copilot import router as copilot_router
from routers.live_detect import router as live_detect_router
from routers.guided_recording import router as guided_recording_router
from routers.voice import router as voice_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    load_mediapipe()
    print("[SkillForge API] Ready")
    yield
    # Shutdown (nothing to clean up)


app = FastAPI(
    title="SkillForge API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded files (frames, videos) as static assets
uploads_dir = Path(__file__).parent / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Routers — digital workflows
app.include_router(workflows_router)
app.include_router(recording_router)
app.include_router(editor_router)
app.include_router(pipeline_router)
app.include_router(copilot_router)
app.include_router(voice_router)

app.include_router(live_detect_router)
app.include_router(guided_recording_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "skillforge-api"}
