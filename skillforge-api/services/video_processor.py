import av
import json
import asyncio
import subprocess
import numpy as np
from pathlib import Path
from PIL import Image
from typing import Callable, Awaitable

FRAMES_DIR = Path(__file__).parent.parent / "uploads" / "frames"


def _bhattacharyya_distance(hist_a: np.ndarray, hist_b: np.ndarray) -> float:
    """Bhattacharyya distance between two normalized histograms."""
    bc = np.sum(np.sqrt(hist_a * hist_b))
    bc = min(bc, 1.0)
    return float(np.sqrt(1.0 - bc)) if bc < 1.0 else 0.0


def _grayscale_histogram(frame: av.VideoFrame) -> np.ndarray:
    """Compute a normalised 256-bin grayscale histogram from a PyAV frame."""
    gray = frame.to_ndarray(format="gray")
    hist, _ = np.histogram(gray.ravel(), bins=256, range=(0, 256))
    total = hist.sum()
    return hist.astype(np.float64) / total if total > 0 else hist.astype(np.float64)


async def extract_frames(
    video_path: str,
    workflow_id: str,
    on_progress: Callable[[str, int], Awaitable[None]] | None = None,
) -> list[dict]:
    """
    Extract key frames from video using scene-change detection.
    Returns list of {timestamp_ms, path, relative_path} dicts.
    Samples at ~1fps, plus extra frames on histogram scene changes.
    """
    output_dir = FRAMES_DIR / workflow_id
    output_dir.mkdir(parents=True, exist_ok=True)

    def _extract_sync() -> list[dict]:
        container = av.open(video_path)
        stream = container.streams.video[0]
        time_base = float(stream.time_base) if stream.time_base else 1.0 / 30.0

        prev_hist = None
        last_sampled_ms = -1000
        results = []

        for frame in container.decode(video=0):
            if frame.pts is None:
                continue
            current_ms = int(frame.pts * time_base * 1000)

            hist = _grayscale_histogram(frame)
            should_save = False

            if current_ms - last_sampled_ms >= 1000:
                should_save = True

            if prev_hist is not None:
                diff = _bhattacharyya_distance(prev_hist, hist)
                if diff > 0.3 and current_ms - last_sampled_ms >= 200:
                    should_save = True

            prev_hist = hist

            if should_save:
                frame_path = output_dir / f"frame_{current_ms:08d}.jpg"
                frame.to_image().save(str(frame_path), "JPEG", quality=90)
                results.append({
                    "timestamp_ms": current_ms,
                    "path": str(frame_path),
                    "relative_path": f"uploads/frames/{workflow_id}/frame_{current_ms:08d}.jpg",
                })
                last_sampled_ms = current_ms

        container.close()
        return results

    loop = asyncio.get_event_loop()
    frames = await loop.run_in_executor(None, _extract_sync)

    if on_progress:
        await on_progress(f"Extracted {len(frames)} key frames", 10)

    return frames


MAX_DURATION_MS = 24 * 60 * 60 * 1000  # 24 hours


def get_video_duration_ms(video_path: str) -> int:
    dur = _duration_via_pyav(video_path)
    if dur is None:
        dur = _duration_via_ffprobe(video_path)
    if dur is None:
        dur = 0
    return min(max(dur, 0), MAX_DURATION_MS)


def _duration_via_pyav(video_path: str) -> int | None:
    """Duration via PyAV container metadata (microseconds → ms)."""
    try:
        container = av.open(video_path)
        if container.duration and container.duration > 0:
            dur_ms = int(container.duration / 1000)
            container.close()
            return dur_ms
        container.close()
        return None
    except Exception as e:
        print(f"[VideoProcessor] PyAV duration extraction failed for {video_path}: {e}", flush=True)
        return None


def _duration_via_ffprobe(video_path: str) -> int | None:
    """Reliable fallback via ffprobe — handles all container formats."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_format", video_path,
            ],
            capture_output=True, text=True, timeout=10,
        )
        info = json.loads(result.stdout)
        seconds = float(info["format"]["duration"])
        return int(seconds * 1000)
    except Exception as e:
        print(f"[VideoProcessor] ffprobe duration extraction failed for {video_path}: {e}", flush=True)
        return None
