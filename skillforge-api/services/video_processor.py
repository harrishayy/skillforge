import cv2
import asyncio
from pathlib import Path
from typing import Callable, Awaitable

FRAMES_DIR = Path(__file__).parent.parent / "uploads" / "frames"


async def extract_frames(
    video_path: str,
    workflow_id: str,
    on_progress: Callable[[str, int], Awaitable[None]] | None = None,
) -> list[dict]:
    """
    Extract key frames from video using scene-change detection.
    Returns list of {timestamp_ms, path} dicts.
    Always samples at ~1fps, plus extra frames on histogram scene changes.
    """
    output_dir = FRAMES_DIR / workflow_id
    output_dir.mkdir(parents=True, exist_ok=True)

    frames: list[dict] = []

    def _extract_sync() -> list[dict]:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        prev_hist = None
        last_sampled_ms = -1000
        results = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_ms = int(cap.get(cv2.CAP_PROP_POS_MSEC))
            frame_idx = int(cap.get(cv2.CAP_PROP_POS_FRAMES))

            # Compute histogram for scene change detection
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
            hist = cv2.normalize(hist, hist).flatten()

            should_save = False

            # Always sample at 1fps
            if current_ms - last_sampled_ms >= 1000:
                should_save = True

            # Also save on significant scene change
            if prev_hist is not None:
                diff = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA)
                if diff > 0.3 and current_ms - last_sampled_ms >= 200:
                    should_save = True

            prev_hist = hist

            if should_save:
                frame_path = output_dir / f"frame_{current_ms:08d}.jpg"
                cv2.imwrite(str(frame_path), frame)
                results.append({
                    "timestamp_ms": current_ms,
                    "path": str(frame_path),
                    "relative_path": f"uploads/frames/{workflow_id}/frame_{current_ms:08d}.jpg",
                })
                last_sampled_ms = current_ms

        cap.release()
        return results

    # Run blocking CV code in thread pool
    loop = asyncio.get_event_loop()
    frames = await loop.run_in_executor(None, _extract_sync)

    if on_progress:
        await on_progress(f"Extracted {len(frames)} key frames", 10)

    return frames


def get_video_duration_ms(video_path: str) -> int:
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    cap.release()
    return int((total_frames / fps) * 1000)
