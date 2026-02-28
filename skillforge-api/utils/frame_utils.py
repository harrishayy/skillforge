import base64
from pathlib import Path
from PIL import Image
import io


def encode_image_b64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def resize_frame_for_api(image_path: str, max_size: int = 1024) -> str:
    """Resize image to max_size on longest dimension, return base64."""
    img = Image.open(image_path)
    w, h = img.size
    if max(w, h) > max_size:
        ratio = max_size / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()
