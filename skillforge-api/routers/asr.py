"""
Nemotron ASR — voice transcription via NVIDIA NIM Parakeet CTC 1.1B.

Receives a raw audio chunk (webm/wav) from the frontend, forwards it to the
ASR endpoint (self-hosted on Brev GPU or NVIDIA NIM cloud), and returns the
transcript text.

Set ASR_URL in .env to point at your Brev-hosted NIM container, e.g.:
  ASR_URL=https://<brev-host>:8000/v1/audio/transcriptions
"""
import os
import httpx
from fastapi import APIRouter, File, UploadFile, HTTPException

router = APIRouter(prefix="/api/voice", tags=["voice"])

_NIM_CLOUD = "https://integrate.api.nvidia.com/v1/audio/transcriptions"
ASR_URL    = os.environ.get("ASR_URL", _NIM_CLOUD)
NIM_MODEL  = "nvidia/parakeet-ctc-1.1b-asr"

_client: httpx.AsyncClient | None = None
_client_url: str | None = None


def _get_client() -> httpx.AsyncClient:
    """Lazily create an httpx client. Recreate if ASR_URL changed at runtime."""
    global _client, _client_url
    url = os.environ.get("ASR_URL", _NIM_CLOUD)
    if _client is None or _client.is_closed or _client_url != url:
        api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")
        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        _client = httpx.AsyncClient(headers=headers, timeout=15.0)
        _client_url = url
    return _client


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)) -> dict:
    """
    Transcribe a short audio chunk using NVIDIA Parakeet CTC 1.1B ASR.

    Accepts any audio format MediaRecorder produces (audio/webm, audio/ogg).
    Returns { "transcript": "..." } or { "transcript": "" } on silence/noise.
    """
    asr_url = os.environ.get("ASR_URL", _NIM_CLOUD)
    is_cloud = asr_url == _NIM_CLOUD
    api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")

    if is_cloud and not api_key:
        raise HTTPException(
            status_code=503,
            detail="NVIDIA_NIM_API_KEY not configured (required for NIM cloud; "
                   "set ASR_URL for self-hosted)",
        )

    audio_bytes = await audio.read()
    if not audio_bytes:
        return {"transcript": ""}

    try:
        client = _get_client()
        files = {"file": (audio.filename or "chunk.webm", audio_bytes, audio.content_type or "audio/webm")}
        data_fields: dict[str, str] = {}
        if is_cloud:
            data_fields["model"] = NIM_MODEL

        resp = await client.post(asr_url, files=files, data=data_fields)
        resp.raise_for_status()
        data = resp.json()
        transcript = (data.get("text") or data.get("transcript") or "").strip()
        if transcript:
            print(f"[ASR] ✓ \"{transcript}\"", flush=True)
        return {"transcript": transcript}

    except httpx.HTTPStatusError as e:
        print(f"[ASR] ✗ ASR error {e.response.status_code}: {e.response.text}", flush=True)
        return {"transcript": ""}
    except Exception as e:
        print(f"[ASR] ✗ {e}", flush=True)
        return {"transcript": ""}
