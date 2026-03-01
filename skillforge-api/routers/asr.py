"""
ASR endpoint — voice transcription via NVIDIA NIM Parakeet CTC 1.1B.

Receives a raw audio chunk (webm/wav) from the frontend, converts it to
16 kHz mono WAV (Parakeet's preferred format), forwards it to the ASR
endpoint, and returns the transcript text.

Set ASR_URL in .env to point at your self-hosted Parakeet container, e.g.:
  ASR_URL=http://localhost:8091/transcribe
"""
import os

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile

from services.asr_service import (
    NIM_CLOUD_URL,
    convert_to_wav,
    detect_av_format,
    transcribe_wav,
)

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)) -> dict:
    """
    Transcribe a short audio chunk using NVIDIA Parakeet CTC 1.1B ASR.

    Accepts any audio format MediaRecorder produces (audio/webm, audio/ogg).
    Converts to 16 kHz mono WAV before forwarding to Parakeet.
    Returns { "transcript": "..." } or { "transcript": "" } on silence/noise.
    """
    asr_url = os.environ.get("ASR_URL", NIM_CLOUD_URL)
    is_cloud = asr_url == NIM_CLOUD_URL
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

    content_type = audio.content_type or "audio/webm"

    av_format = detect_av_format(content_type)
    if av_format:
        try:
            audio_bytes = convert_to_wav(audio_bytes, av_format)
        except Exception as e:
            print(f"[ASR] WAV conversion failed ({av_format}->wav): {e}", flush=True)

    try:
        transcript = await transcribe_wav(audio_bytes)
        if transcript:
            print(f'[ASR] "{transcript}"', flush=True)
        return {"transcript": transcript}

    except httpx.HTTPStatusError as e:
        print(
            f"[ASR] ASR error {e.response.status_code}: {e.response.text}",
            flush=True,
        )
        raise HTTPException(
            status_code=502,
            detail=f"ASR upstream error {e.response.status_code}",
        )
    except (httpx.ConnectError, httpx.ConnectTimeout) as e:
        print(f"[ASR] ASR unreachable at {asr_url}: {e}", flush=True)
        raise HTTPException(
            status_code=503,
            detail=f"ASR server unreachable at {asr_url}",
        )
    except Exception as e:
        print(f"[ASR] {e}", flush=True)
        raise HTTPException(status_code=503, detail=str(e))
