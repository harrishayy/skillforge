import asyncio
import cv2
import numpy as np

# Module-level singletons — loaded once at startup via load_mediapipe()
_mp_hands = None  # mp.solutions.hands module
_mp_drawing = None
_hands_instance = None  # persistent Hands detector (avoids per-frame re-init)


def load_mediapipe():
    global _mp_hands, _mp_drawing, _hands_instance
    try:
        import mediapipe as mp
        _mp_hands = mp.solutions.hands
        _mp_drawing = mp.solutions.drawing_utils
        # static_image_mode=False enables tracking mode: faster after initial detection
        _hands_instance = _mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        print("[MediaPipe] Hands solution loaded")
    except Exception as e:
        print(f"[MediaPipe] Could not load: {e}. Hand tracking will be skipped.")


def extract_hand_data_from_bytes(frame_bytes: bytes) -> dict | None:
    """Run MediaPipe hand detection on raw JPEG bytes (avoids disk I/O)."""
    if _mp_hands is None:
        return None

    try:
        arr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return None
        return _process_frame(frame)
    except Exception as e:
        print(f"[MediaPipe] Error: {e}")
        return None


def extract_hand_data_sync(frame_path: str) -> dict | None:
    """Run MediaPipe hand detection on a frame file path."""
    if _mp_hands is None:
        return None

    try:
        frame = cv2.imread(frame_path)
        if frame is None:
            return None
        return _process_frame(frame)
    except Exception as e:
        print(f"[MediaPipe] Error: {e}")
        return None


def _process_frame(frame) -> dict | None:
    """Shared processing logic for both path and bytes variants."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = _hands_instance.process(rgb)

    if not results.multi_hand_landmarks:
        return None

    all_hands = []
    for hand_landmarks in results.multi_hand_landmarks:
        points = [
            {"x": lm.x * 100, "y": lm.y * 100, "z": lm.z}
            for lm in hand_landmarks.landmark
        ]
        # Index fingertip = landmark 8 (percentage coords, consistent with other fields)
        all_hands.append({"landmarks": points})

    return {
        "hand_count": len(all_hands),
        "hands": all_hands,
        # Primary pointer: index fingertip of first hand (landmark 8)
        "pointing_at": all_hands[0]["landmarks"][8] if all_hands else None,
    }


async def extract_hand_data(frame_path: str) -> dict | None:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, extract_hand_data_sync, frame_path)
