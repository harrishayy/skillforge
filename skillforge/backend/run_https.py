"""
Run the AR WebSocket server with SSL (WSS) so the camera room works when the
Next.js app is served over HTTPS.

Uses backend certs that include the LAN IP first (phone needs these to connect).
Falls back to Next.js localhost certs if LAN certs are not present.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

def main() -> None:
    backend_dir = Path(__file__).resolve().parent
    # Prefer backend/certificates/ with LAN IP (phone needs hostname to match)
    backend_certs = backend_dir / "certificates"
    keyfile = backend_certs / "key.pem"
    certfile = backend_certs / "cert.pem"
    if not keyfile.is_file() or not certfile.is_file():
        # Fall back to Next.js localhost certs (laptop viewer works; phone may fail)
        next_certs = backend_dir.parent / "certificates"
        keyfile = next_certs / "localhost-key.pem"
        certfile = next_certs / "localhost.pem"
        if keyfile.is_file() and certfile.is_file():
            print(
                "Using localhost certs. Phone connections may fail (cert mismatch).",
                file=sys.stderr,
            )
            print(
                "For phone: mkcert -key-file backend/certificates/key.pem "
                "-cert-file backend/certificates/cert.pem <LAN-IP> localhost 127.0.0.1",
                file=sys.stderr,
            )

    if not keyfile.is_file() or not certfile.is_file():
        print("SSL certificates not found.", file=sys.stderr)
        print(f"Run Next.js dev:https once, or create LAN certs:", file=sys.stderr)
        print("  mkdir -p skillforge/backend/certificates", file=sys.stderr)
        print("  cd skillforge/backend && mkcert -key-file certificates/key.pem "
              "-cert-file certificates/cert.pem <YOUR-LAN-IP> localhost 127.0.0.1", file=sys.stderr)
        sys.exit(1)

    host = os.environ.get("AR_HOST", "0.0.0.0")
    port = int(os.environ.get("AR_PORT", "8001"))
    print(f"Starting AR server with WSS on https://{host}:{port}", flush=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host", host,
            "--port", str(port),
            "--ssl-keyfile", str(keyfile),
            "--ssl-certfile", str(certfile),
        ],
        cwd=backend_dir,
    )

if __name__ == "__main__":
    main()
