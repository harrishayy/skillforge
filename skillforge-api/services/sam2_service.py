"""
Segmentation service for physical workflows using SAM 2.

Calls a local SAM 2 inference endpoint (if SAM2_URL is set).
Returns the path to a saved mask PNG, or None if unavailable.
"""
import os
import base64
import httpx
from pathlib import Path


SAM2_URL = os.environ.get("SAM2_URL", "")


async def segment_object(
    frame_path: str,
    bbox: list[float],  # [x, y, w, h] normalized 0-1
    output_dir: Path | None = None,
    mask_filename: str | None = None,
) -> str | None:
    """
    Segment the object at `bbox` in the given frame using SAM 2.

    Args:
        frame_path: Absolute path to the input frame JPEG/PNG.
        bbox: Normalized [x, y, w, h] bounding box used as SAM prompt.
        output_dir: Directory to save the mask PNG. Defaults to same dir as frame.
        mask_filename: Override filename for the mask. Defaults to <frame_stem>_mask.png.

    Returns:
        Relative path string to the saved mask, or None if unavailable.
    """
    if not SAM2_URL:
        print("[SAM2] SAM2_URL not set — segmentation skipped")
        return None

    frame_p = Path(frame_path)
    out_dir = output_dir or frame_p.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = mask_filename or f"{frame_p.stem}_mask.png"
    mask_path = out_dir / out_name

    try:
        with open(frame_path, "rb") as f:
            image_bytes = f.read()

        # Convert normalized bbox to pixel coords for SAM 2 prompt
        # SAM 2 server is expected to accept normalized coords [x1, y1, x2, y2]
        x, y, w, h = bbox
        box_prompt = [x, y, x + w, y + h]

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{SAM2_URL}/segment",
                files={"image": ("frame.jpg", image_bytes, "image/jpeg")},
                data={"box": ",".join(str(v) for v in box_prompt)},
            )
            resp.raise_for_status()

        # Expect raw PNG bytes in response
        mask_path.write_bytes(resp.content)
        return str(mask_path)

    except Exception as e:
        print(f"[SAM2] Segmentation failed: {e}")
        return None
