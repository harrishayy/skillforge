"""
Shared ASR (Automatic Speech Recognition) utilities.

Provides audio conversion, audio extraction from video, and Parakeet
transcription used by both the real-time transcription endpoint
(routers/asr.py) and the background pipeline (hardware_pipeline.py).
"""
import io
import os

import av
import httpx

NIM_CLOUD_URL = "https://integrate.api.nvidia.com/v1/audio/transcriptions"
NIM_MODEL = "nvidia/parakeet-ctc-1.1b-asr"
TARGET_SAMPLE_RATE = 16_000

_client: httpx.AsyncClient | None = None
_client_url: str | None = None


def _get_client() -> httpx.AsyncClient:
    """Lazily create an httpx client. Recreate if ASR_URL changed at runtime."""
    global _client, _client_url
    url = os.environ.get("ASR_URL", NIM_CLOUD_URL)
    if _client is None or _client.is_closed or _client_url != url:
        api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")
        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        _client = httpx.AsyncClient(headers=headers, timeout=30.0)
        _client_url = url
    return _client


def detect_av_format(content_type: str | None) -> str | None:
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


def convert_to_wav(audio_bytes: bytes, source_format: str) -> bytes:
    """Convert audio bytes (webm/ogg/etc.) to 16 kHz mono PCM WAV using PyAV."""
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


def extract_audio_from_video(video_path: str) -> bytes | None:
    """
    Extract the audio track from a video file and return 16 kHz mono WAV bytes.
    Returns None if the video has no audio track or extraction fails.
    """
    try:
        output_buf = io.BytesIO()
        with av.open(video_path) as container:
            if not container.streams.audio:
                return None
            in_stream = container.streams.audio[0]

            with av.open(output_buf, "w", format="wav") as out_container:
                out_stream = out_container.add_stream(
                    "pcm_s16le", rate=TARGET_SAMPLE_RATE, layout="mono"
                )
                resampler = av.AudioResampler(
                    format="s16", layout="mono", rate=TARGET_SAMPLE_RATE
                )
                for frame in container.decode(in_stream):
                    for resampled in resampler.resample(frame):
                        for packet in out_stream.encode(resampled):
                            out_container.mux(packet)
                for packet in out_stream.encode(None):
                    out_container.mux(packet)

        wav_bytes = output_buf.getvalue()
        if len(wav_bytes) < 100:
            return None
        return wav_bytes
    except Exception as e:
        print(f"[ASR] Audio extraction from video failed: {e}", flush=True)
        return None


def _parse_asr_response(data: dict) -> str:
    """Extract transcript text from a Parakeet/NIM ASR response."""
    return (
        data.get("text")
        or data.get("transcript")
        or data.get("transcription")
        or ""
    ).strip()


async def transcribe_wav(wav_bytes: bytes) -> str:
    """
    Send 16 kHz mono WAV audio to the Parakeet ASR endpoint.
    Uses the cached httpx client for connection reuse.
    Returns the transcript string, or empty string on failure.

    The self-hosted Parakeet server exposes two endpoints:
      POST /transcribe              — field name: "audio"
      POST /v1/audio/transcriptions — field name: "file"  (NIM-compatible)
    The field name is chosen based on which endpoint the ASR_URL points to.
    """
    asr_url = os.environ.get("ASR_URL", NIM_CLOUD_URL)
    is_cloud = asr_url == NIM_CLOUD_URL
    api_key = os.environ.get("NVIDIA_NIM_API_KEY", "")

    if is_cloud and not api_key:
        return ""

    client = _get_client()

    # /transcribe expects "audio"; /v1/audio/transcriptions and NIM cloud expect "file"
    field_name = "audio" if asr_url.rstrip("/").endswith("/transcribe") else "file"
    files = {field_name: ("audio.wav", wav_bytes, "audio/wav")}
    data_fields: dict[str, str] = {}
    if is_cloud:
        data_fields["model"] = NIM_MODEL

    resp = await client.post(asr_url, files=files, data=data_fields)
    if resp.status_code >= 400:
        print(
            f"[ASR] ASR returned {resp.status_code}: {resp.text[:300]}",
            flush=True,
        )
    resp.raise_for_status()
    return _parse_asr_response(resp.json())
