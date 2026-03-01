"""
Nemotron ASR — voice transcription via NVIDIA NIM Parakeet CTC 1.1B.

Receives a raw audio chunk (webm/wav) from the frontend, converts it to
16 kHz mono WAV (Parakeet's preferred format), forwards it to the ASR
endpoint, and returns the transcript text.

Set ASR_URL in .env to point at your self-hosted Parakeet container, e.g.:
  ASR_URL=http://localhost:8091/transcribe
"""
import io
import os

import av
import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter(prefix="/api/voice", tags=["voice"])

_NIM_CLOUD = "https://integrate.api.nvidia.com/v1/audio/transcriptions"
NIM_MODEL = "nvidia/parakeet-ctc-1.1b-asr"

_client: httpx.AsyncClient | None = None
_client_url: str | None = None

TARGET_SAMPLE_RATE = 16_000


def _get_client() -> httpx.AsyncClient:
    """Lazily create an httpx client. Recreate if ASR_URL changed at runtime."""
    global _client, _client_url
    url = os.environ.get("ASR_URL", _NIM_CLOUD)
    if _client is None or _client.is_closed or _client_url != url:
        api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")
        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        _client = httpx.AsyncClient(headers=headers, timeout=30.0)
        _client_url = url
    return _client


def _convert_to_wav(audio_bytes: bytes, source_format: str) -> bytes:
    """Convert audio (webm/ogg/etc.) to 16 kHz mono PCM WAV using PyAV."""
    input_buf = io.BytesIO(audio_bytes)
    output_buf = io.BytesIO()

    with av.open(input_buf, format=source_format) as in_container:
        in_stream = in_container.streams.audio[0]

        with av.open(output_buf, "w", format="wav") as out_container:
            out_stream = out_container.add_stream(
                "pcm_s16le", rate=TARGET_SAMPLE_RATE, layout="mono"
            )

            resampler = av.AudioResampler(
                format="s16", layout="mono", rate=TARGET_SAMPLE_RATE
            )

            for frame in in_container.decode(in_stream):
                for resampled in resampler.resample(frame):
                    for packet in out_stream.encode(resampled):
                        out_container.mux(packet)

            for packet in out_stream.encode(None):
                out_container.mux(packet)

    return output_buf.getvalue()


def _detect_av_format(content_type: str | None) -> str | None:
    """Map MIME content type to a PyAV container format string."""
    if not content_type:
        return None
    ct = content_type.lower()
    if "webm" in ct:
        return "webm"
    if "ogg" in ct:
        return "ogg"
    if "mp4" in ct or "m4a" in ct:
        return "mp4"
    return None


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)) -> dict:
    """
    Transcribe a short audio chunk using NVIDIA Parakeet CTC 1.1B ASR.

    Accepts any audio format MediaRecorder produces (audio/webm, audio/ogg).
    Converts to 16 kHz mono WAV before forwarding to Parakeet.
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

    filename = audio.filename or "chunk.webm"
    content_type = audio.content_type or "audio/webm"

    av_format = _detect_av_format(content_type)
    if av_format:
        try:
            audio_bytes = _convert_to_wav(audio_bytes, av_format)
            filename = "chunk.wav"
            content_type = "audio/wav"
        except Exception as e:
            print(f"[ASR] ⚠ WAV conversion failed ({av_format}→wav): {e}", flush=True)

    try:
        client = _get_client()
        files = {"file": (filename, audio_bytes, content_type)}
        data_fields: dict[str, str] = {}
        if is_cloud:
            data_fields["model"] = NIM_MODEL

        resp = await client.post(asr_url, files=files, data=data_fields)
        resp.raise_for_status()
        data = resp.json()
        transcript = (
            data.get("text")
            or data.get("transcript")
            or data.get("transcription")
            or ""
        ).strip()
        if transcript:
            print(f'[ASR] ✓ "{transcript}"', flush=True)
        return {"transcript": transcript}

    except httpx.HTTPStatusError as e:
        print(
            f"[ASR] ✗ ASR error {e.response.status_code}: {e.response.text}",
            flush=True,
        )
        raise HTTPException(
            status_code=502,
            detail=f"ASR upstream error {e.response.status_code}",
        )
    except (httpx.ConnectError, httpx.ConnectTimeout) as e:
        print(f"[ASR] ✗ ASR unreachable at {asr_url}: {e}", flush=True)
        raise HTTPException(
            status_code=503,
            detail=f"ASR server unreachable at {asr_url}",
        )
    except Exception as e:
        print(f"[ASR] ✗ {e}", flush=True)
        raise HTTPException(status_code=503, detail=str(e))
