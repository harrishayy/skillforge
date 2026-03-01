"""
SAM3 Client-Side Tracker

Runs OpenCV TrackerVit locally for real-time bounding box tracking.
Calls the remote SAM3 server only for:
  1. Initial text-based detection (frame 0)
  2. Periodic re-detection to correct drift (async, non-blocking)
  3. Recovery when the tracker loses the object

Architecture:
  ┌──────────────────────────────────┐
  │  Client (runs locally)           │
  │  - OpenCV TrackerVit (<12ms)     │
  │  - Camera / video capture        │
  │  - Async SAM3 requests           │
  └──────────┬───────────────────────┘
             │ Only on detection frames
             │ (frame 0 + every N seconds)
             ▼
  ┌──────────────────────────────────┐
  │  SAM3 Server (remote GPU)        │
  │  - POST /segment                 │
  │  - text or box prompt → mask+box │
  │  - ~300ms per call               │
  └──────────────────────────────────┘

Usage:
    tracker = SAM3Tracker("http://<server>:8080")
    result = tracker.detect(frame, text="person")  # initial detection
    ...
    result = tracker.track(frame)                   # local tracking (<12ms)
    ...
    result = tracker.redetect(frame)                # drift correction (~300ms)
"""

import os
import io
import time
import base64
import logging
import threading
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
import httpx
from PIL import Image

logger = logging.getLogger(__name__)

SAM3_URL = os.environ.get("SAM3_URL", "")


@dataclass
class TrackResult:
    """Result from a tracking or detection call."""
    box: Optional[list[float]] = None       # [x1, y1, x2, y2] pixel coords
    score: float = 0.0
    mask_png: Optional[bytes] = None        # raw PNG bytes (only on SAM3 detection frames)
    source: str = "none"                    # "sam3", "tracker", "sam3_redetect", "sam3_recovery", "lost"
    elapsed_ms: float = 0.0
    frame_index: int = 0

    @property
    def found(self) -> bool:
        return self.box is not None


class SAM3Tracker:
    """
    Client-side tracker that combines local OpenCV tracking with remote
    SAM3 detection for drift correction.

    The tracker runs entirely locally (<12ms/frame). SAM3 is only called
    for initial detection and periodic re-detection, either synchronously
    or asynchronously (non-blocking).

    Args:
        server_url: Base URL of the SAM3 server (e.g. "http://localhost:8080")
        models_dir: Path to directory containing tracker ONNX models.
                    If None, searches ./tracker_models/ and common locations.
        redetect_interval: Seconds between automatic re-detections (0 = manual only)
        timeout: HTTP timeout for SAM3 server requests in seconds
    """

    def __init__(
        self,
        server_url: Optional[str] = None,
        models_dir: Optional[str] = None,
        redetect_interval: float = 2.0,
        timeout: float = 10.0,
    ):
        self.server_url = (server_url or SAM3_URL or "http://localhost:8080").rstrip("/")
        self.timeout = timeout
        self.redetect_interval = redetect_interval
        logger.info(f"[SAM3Client] Server URL: {self.server_url}")

        self.models_dir = models_dir or self._find_models_dir()
        self._tracker: Optional[cv2.Tracker] = None
        self._text: Optional[str] = None
        self._current_box: Optional[list[float]] = None
        self._frame_index: int = 0
        self._last_detect_time: float = 0.0
        self._orig_w: int = 0
        self._orig_h: int = 0

        # Async re-detection state
        self._async_lock = threading.Lock()
        self._pending_redetect: Optional[threading.Thread] = None
        self._async_result: Optional[TrackResult] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray, text: str) -> TrackResult:
        """
        Initial detection. Sends the frame + text prompt to SAM3, initializes
        the local tracker with the result. Call this once at the start.

        Args:
            frame: BGR numpy array (from cv2.VideoCapture or camera)
            text: What to find (e.g. "person", "red car")

        Returns:
            TrackResult with box, score, mask, source="sam3"
        """
        self._text = text
        self._orig_h, self._orig_w = frame.shape[:2]
        self._frame_index = 0

        result = self._call_sam3(frame, text=text)
        if result.found:
            self._init_tracker(frame, result.box)
            self._last_detect_time = time.time()

        result.frame_index = 0
        return result

    def track(self, frame: np.ndarray) -> TrackResult:
        """
        Track the object in a new frame using the local OpenCV tracker.
        Automatically triggers async SAM3 re-detection when redetect_interval
        has elapsed. Returns immediately (<12ms).

        Args:
            frame: BGR numpy array

        Returns:
            TrackResult with box from local tracker, source="tracker"
        """
        self._frame_index += 1
        t0 = time.time()

        # Check for completed async re-detection
        with self._async_lock:
            if self._async_result is not None:
                async_res = self._async_result
                self._async_result = None
                if async_res.found:
                    self._current_box = async_res.box
                    self._init_tracker(frame, async_res.box)
                    async_res.frame_index = self._frame_index
                    async_res.elapsed_ms = (time.time() - t0) * 1000
                    return async_res

        # Auto re-detection trigger
        if (
            self.redetect_interval > 0
            and self._current_box is not None
            and time.time() - self._last_detect_time >= self.redetect_interval
            and self._pending_redetect is None
        ):
            self._start_async_redetect(frame)

        # Local tracker update
        if self._tracker is None:
            return TrackResult(source="lost", frame_index=self._frame_index)

        ok, bbox = self._tracker.update(frame)
        elapsed = (time.time() - t0) * 1000

        if ok:
            x, y, w, h = [float(v) for v in bbox]
            self._current_box = [x, y, x + w, y + h]
            return TrackResult(
                box=self._current_box,
                score=1.0,
                source="tracker",
                elapsed_ms=elapsed,
                frame_index=self._frame_index,
            )
        else:
            # Tracker lost -- do synchronous SAM3 recovery
            result = self._call_sam3(frame, text=self._text)
            result.source = "sam3_recovery"
            result.frame_index = self._frame_index
            if result.found:
                self._init_tracker(frame, result.box)
                self._last_detect_time = time.time()
            return result

    def redetect(self, frame: np.ndarray) -> TrackResult:
        """
        Manually trigger a synchronous SAM3 re-detection. Use this when you
        want explicit control over when re-detection happens.

        Uses the current bounding box as a hint (box prompt) for faster,
        more targeted detection. Falls back to text if no current box.

        Args:
            frame: BGR numpy array

        Returns:
            TrackResult with refreshed box + mask from SAM3
        """
        self._frame_index += 1

        if self._current_box is not None:
            result = self._call_sam3(frame, box=self._current_box)
        else:
            result = self._call_sam3(frame, text=self._text)

        result.source = "sam3_redetect"
        result.frame_index = self._frame_index

        if result.found:
            self._init_tracker(frame, result.box)
            self._last_detect_time = time.time()

        return result

    def reset(self):
        """Reset tracker state. Call detect() again to start over."""
        self._tracker = None
        self._current_box = None
        self._text = None
        self._frame_index = 0
        self._async_result = None

    @property
    def current_box(self) -> Optional[list[float]]:
        """Current bounding box [x1, y1, x2, y2] or None if lost."""
        return self._current_box

    @property
    def frame_index(self) -> int:
        return self._frame_index

    # ------------------------------------------------------------------
    # Async re-detection
    # ------------------------------------------------------------------

    def _start_async_redetect(self, frame: np.ndarray):
        """Fire off a non-blocking SAM3 re-detection in a background thread."""
        frame_copy = frame.copy()
        box_copy = list(self._current_box) if self._current_box else None

        def _run():
            try:
                if box_copy:
                    result = self._call_sam3(frame_copy, box=box_copy)
                else:
                    result = self._call_sam3(frame_copy, text=self._text)
                result.source = "sam3_redetect"
                with self._async_lock:
                    self._async_result = result
                    self._last_detect_time = time.time()
            except Exception:
                pass
            finally:
                self._pending_redetect = None

        self._pending_redetect = threading.Thread(target=_run, daemon=True)
        self._pending_redetect.start()

    # ------------------------------------------------------------------
    # SAM3 server calls
    # ------------------------------------------------------------------

    def _call_sam3(
        self,
        frame: np.ndarray,
        text: Optional[str] = None,
        box: Optional[list[float]] = None,
    ) -> TrackResult:
        """
        Call SAM3 /segment endpoint with either text or box prompt.

        The SAM3 server expects normalized (0-1) coordinates for box prompts
        and returns normalized (0-1) bounding boxes. This method handles the
        conversion to/from pixel coordinates used by the OpenCV tracker.
        """
        t0 = time.time()
        h, w = frame.shape[:2]

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=90)
        buf.seek(0)

        files = {"image": ("frame.jpg", buf, "image/jpeg")}
        data = {}
        if text:
            data["text"] = text
        elif box:
            data["box"] = f"{box[0]/w},{box[1]/h},{box[2]/w},{box[3]/h}"

        try:
            resp = httpx.post(
                f"{self.server_url}/segment",
                files=files,
                data=data,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            body = resp.json()
        except httpx.ConnectError:
            logger.error(f"[SAM3Client] Connection refused — is the server running at {self.server_url}?")
            return TrackResult(source="error", elapsed_ms=(time.time() - t0) * 1000)
        except httpx.TimeoutException:
            logger.error(f"[SAM3Client] Request timed out ({self.timeout}s limit)")
            return TrackResult(source="error", elapsed_ms=(time.time() - t0) * 1000)
        except Exception as e:
            logger.error(f"[SAM3Client] Request failed: {e}")
            return TrackResult(source="error", elapsed_ms=(time.time() - t0) * 1000)

        elapsed = (time.time() - t0) * 1000

        if body.get("error"):
            logger.error(f"[SAM3Client] Server error: {body['error']}")
            return TrackResult(source="error", elapsed_ms=elapsed)

        if not body.get("scores"):
            return TrackResult(source="lost", elapsed_ms=elapsed)

        scores = body["scores"]
        best = int(np.argmax(scores))

        norm_box = body["boxes"][best]
        best_box = [norm_box[0] * w, norm_box[1] * h, norm_box[2] * w, norm_box[3] * h]

        mask_png = None
        if body.get("masks"):
            mask_png = base64.b64decode(body["masks"][best])

        prompt_type = "text" if text else "box"
        logger.info(f"[SAM3Client] {prompt_type} prompt — score={scores[best]:.2f} in {elapsed:.0f}ms")

        return TrackResult(
            box=best_box,
            score=scores[best],
            mask_png=mask_png,
            source="sam3",
            elapsed_ms=elapsed,
        )

    # ------------------------------------------------------------------
    # Local OpenCV tracker
    # ------------------------------------------------------------------

    def _init_tracker(self, frame: np.ndarray, box_xyxy: list[float]):
        """Initialize a new OpenCV tracker with the given bounding box."""
        x1, y1, x2, y2 = box_xyxy
        bbox = (int(x1), int(y1), int(x2 - x1), int(y2 - y1))
        self._tracker = self._create_tracker()
        self._tracker.init(frame, bbox)
        self._current_box = box_xyxy

    def _create_tracker(self) -> cv2.Tracker:
        """Create the best available OpenCV tracker."""
        d = self.models_dir

        if d:
            vit = os.path.join(d, "vitTracker.onnx")
            if os.path.exists(vit):
                try:
                    params = cv2.TrackerVit_Params()
                    params.net = vit
                    return cv2.TrackerVit_create(params)
                except Exception:
                    pass

            rpn = os.path.join(d, "dasiamrpn_model.onnx")
            cls = os.path.join(d, "dasiamrpn_kernel_cls1.onnx")
            reg = os.path.join(d, "dasiamrpn_kernel_r1.onnx")
            if all(os.path.exists(p) for p in [rpn, cls, reg]):
                try:
                    params = cv2.TrackerDaSiamRPN_Params()
                    params.model = rpn
                    params.kernel_cls1 = cls
                    params.kernel_r1 = reg
                    return cv2.TrackerDaSiamRPN_create(params)
                except Exception:
                    pass

            bb = os.path.join(d, "nanotrack_backbone_sim.onnx")
            nh = os.path.join(d, "nanotrack_head_sim.onnx")
            if os.path.exists(bb) and os.path.exists(nh):
                try:
                    params = cv2.TrackerNano_Params()
                    params.backbone = bb
                    params.neckhead = nh
                    return cv2.TrackerNano_create(params)
                except Exception:
                    pass

        return cv2.TrackerMIL_create()

    @staticmethod
    def _find_models_dir() -> Optional[str]:
        """Search common locations for tracker model files."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(os.getcwd(), "tracker_models"),
            os.path.join(script_dir, "..", "tracker_models"),
            os.path.join(script_dir, "tracker_models"),
            os.path.expanduser("~/tracker_models"),
            "/home/shadeform/tracker_models",
        ]
        for path in candidates:
            if os.path.isdir(path) and os.path.exists(os.path.join(path, "vitTracker.onnx")):
                return os.path.abspath(path)
        return None


# ======================================================================
# Convenience functions for quick usage
# ======================================================================

def process_video(
    video_path: str,
    text: str,
    server_url: Optional[str] = None,
    sample_fps: float = 0,
    redetect_every: float = 2.0,
    models_dir: Optional[str] = None,
    on_frame=None,
) -> list[TrackResult]:
    """
    Process a video file with client-side tracking + server-side SAM3.

    Args:
        video_path: Path to video file
        text: What to track
        server_url: SAM3 server URL
        sample_fps: Downsample frame rate (0 = native)
        redetect_every: Seconds between SAM3 re-detections
        models_dir: Path to tracker ONNX models
        on_frame: Optional callback(frame_bgr, result) called per frame

    Returns:
        List of TrackResult for each processed frame
    """
    tracker = SAM3Tracker(
        server_url=server_url,
        models_dir=models_dir,
        redetect_interval=0,  # manual control
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if sample_fps > 0 and sample_fps < native_fps:
        frame_interval = native_fps / sample_fps
        effective_fps = sample_fps
    else:
        frame_interval = 1.0
        effective_fps = native_fps

    redetect_frame_interval = int(redetect_every * effective_fps) if redetect_every > 0 else 0

    results = []
    frame_num = 0
    sample_idx = 0
    next_sample = 0.0

    while True:
        ret, bgr = cap.read()
        if not ret:
            break

        if frame_num < next_sample:
            frame_num += 1
            continue
        next_sample += frame_interval

        if sample_idx == 0:
            result = tracker.detect(bgr, text=text)
        elif redetect_frame_interval > 0 and sample_idx % redetect_frame_interval == 0:
            result = tracker.redetect(bgr)
        else:
            result = tracker.track(bgr)

        result.frame_index = sample_idx
        results.append(result)

        if on_frame:
            on_frame(bgr, result)

        sample_idx += 1
        frame_num += 1

    cap.release()
    return results
