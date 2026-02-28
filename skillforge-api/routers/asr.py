"""
Nemotron ASR — voice transcription via NVIDIA NIM Parakeet CTC 1.1B.

Receives a raw audio chunk (webm/wav) from the frontend, forwards it to the
NVIDIA NIM audio transcription API, and returns the transcript text.

The frontend hook (useNemotronASR) sends 1.5s chunks captured from the shared
mic stream (useMicStream) — no extra getUserMedia needed.
"""
import os
import httpx
from fastapi import APIRouter, File, UploadFile, HTTPException

router = APIRouter(prefix="/api/voice", tags=["voice"])

NIM_ASR_URL = "https://integrate.api.nvidia.com/v1/audio/transcriptions"
NIM_MODEL   = "nvidia/parakeet-ctc-1.1b-asr"

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")
        _client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15.0,
        )
    return _client


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)) -> dict:
    """
    Transcribe a short audio chunk using NVIDIA NIM Parakeet CTC 1.1B ASR.

    Accepts any audio format MediaRecorder produces (audio/webm, audio/ogg).
    Returns { "transcript": "..." } or { "transcript": "" } on silence/noise.
    """
    api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="NVIDIA_NIM_API_KEY not configured")

    audio_bytes = await audio.read()
    if not audio_bytes:
        return {"transcript": ""}

    try:
        client = _get_client()
        resp = await client.post(
            NIM_ASR_URL,
            files={
                "file": (audio.filename or "chunk.webm", audio_bytes, audio.content_type or "audio/webm"),
            },
            data={"model": NIM_MODEL},
        )
        resp.raise_for_status()
        data = resp.json()
        transcript = (data.get("text") or "").strip()
        if transcript:
            print(f"[ASR] ✓ \"{transcript}\"", flush=True)
        return {"transcript": transcript}

    except httpx.HTTPStatusError as e:
        print(f"[ASR] ✗ NIM error {e.response.status_code}: {e.response.text}", flush=True)
        return {"transcript": ""}
    except Exception as e:
        print(f"[ASR] ✗ {e}", flush=True)
        return {"transcript": ""}
