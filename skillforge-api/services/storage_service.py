"""
Cloudflare R2 storage service.

Uploads videos and extracted frames to a Cloudflare R2 bucket (S3-compatible API).
Returns a public URL that can be stored in the database and served via CDN.

All functions degrade gracefully: if R2 is not configured (env vars missing),
they return the original local path unchanged so local development continues
to work with the local /uploads static file server.

Required environment variables:
  CF_R2_ACCOUNT_ID       Cloudflare account ID
  CF_R2_ACCESS_KEY_ID    R2 API token access key
  CF_R2_SECRET_ACCESS_KEY R2 API token secret key
  CF_R2_BUCKET_NAME      Bucket name (e.g. skillforge-media)
  CF_R2_PUBLIC_URL       Public base URL (e.g. https://pub-xxx.r2.dev)
"""
import asyncio
import os
from pathlib import Path
from functools import lru_cache

_CF_ACCOUNT_ID = os.environ.get("CF_R2_ACCOUNT_ID", "")
_CF_ACCESS_KEY = os.environ.get("CF_R2_ACCESS_KEY_ID", "")
_CF_SECRET_KEY = os.environ.get("CF_R2_SECRET_ACCESS_KEY", "")
_CF_BUCKET = os.environ.get("CF_R2_BUCKET_NAME", "skillforge-media")
_CF_PUBLIC_URL = os.environ.get("CF_R2_PUBLIC_URL", "").rstrip("/")


def is_configured() -> bool:
    """Return True if all required R2 environment variables are set."""
    return bool(_CF_ACCOUNT_ID and _CF_ACCESS_KEY and _CF_SECRET_KEY and _CF_PUBLIC_URL)


@lru_cache(maxsize=1)
def _get_client():
    """Lazy-initialize and cache the boto3 S3 client for R2."""
    import boto3
    endpoint = f"https://{_CF_ACCOUNT_ID}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=_CF_ACCESS_KEY,
        aws_secret_access_key=_CF_SECRET_KEY,
        region_name="auto",
    )


def _sync_upload_file(local_path: str, key: str, content_type: str = "application/octet-stream") -> str:
    """Blocking upload — called via run_in_executor."""
    client = _get_client()
    client.upload_file(
        local_path,
        _CF_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"{_CF_PUBLIC_URL}/{key}"


def _sync_upload_bytes(data: bytes, key: str, content_type: str = "application/octet-stream") -> str:
    """Blocking upload from memory — called via run_in_executor."""
    import io
    client = _get_client()
    client.upload_fileobj(
        io.BytesIO(data),
        _CF_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"{_CF_PUBLIC_URL}/{key}"


async def upload_file(local_path: str, key: str, content_type: str | None = None) -> str:
    """
    Upload a local file to R2 and return its public URL.
    If R2 is not configured, returns the local path unchanged.
    """
    if not is_configured():
        return local_path

    if content_type is None:
        content_type = _guess_content_type(local_path)

    try:
        loop = asyncio.get_event_loop()
        url = await loop.run_in_executor(None, _sync_upload_file, local_path, key, content_type)
        print(f"[R2] Uploaded {key} → {url}")
        return url
    except Exception as e:
        print(f"[R2] Upload failed for {key}: {e}. Returning local path.")
        return local_path


async def upload_bytes(data: bytes, key: str, content_type: str = "image/jpeg") -> str:
    """
    Upload bytes to R2 and return the public URL.
    If R2 is not configured, returns the key unchanged.
    """
    if not is_configured():
        return key

    try:
        loop = asyncio.get_event_loop()
        url = await loop.run_in_executor(None, _sync_upload_bytes, data, key, content_type)
        return url
    except Exception as e:
        print(f"[R2] Bytes upload failed for {key}: {e}.")
        return key


def make_video_key(workflow_id: str, filename: str) -> str:
    """Build an R2 object key for a workflow video."""
    return f"videos/{workflow_id}/{filename}"


def make_frame_key(workflow_id: str, filename: str) -> str:
    """Build an R2 object key for an extracted frame."""
    return f"frames/{workflow_id}/{filename}"



def _guess_content_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webm": "video/webm",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".npy": "application/octet-stream",
    }.get(ext, "application/octet-stream")
