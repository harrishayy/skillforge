# Camera Feed Fix — Progress Log
**Branch:** `fix/camera-feed`

---

## ✅ CAMERA STREAMING IS WORKING

Phone camera successfully streams to laptop. Hand detection overlay renders. All core issues resolved.

### How to start (every session — 3 terminals)
```bash
# Terminal 1 — AR backend  (MEDIAPIPE_DELEGATE=cpu REQUIRED — GPU crashes on M4 Pro at runtime)
cd skillforge/skillforge/backend
MEDIAPIPE_DELEGATE=cpu skillforge-api/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001

# Terminal 2 — Next.js
cd skillforge/skillforge
npm run dev    # runs: node server.mjs

# Terminal 3 — ngrok (tunnels port 3000 for phone access via HTTPS)
ngrok http 3000
# → update skillforge/.env.local: NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_WS_HOST with new URL
# → restart npm run dev after updating .env.local
```

### On laptop: open http://localhost:3000/live
### On phone: scan QR code → grant camera → tap "Start camera"

---

## Architecture

```
Phone  ──wss──►  ngrok (port 3000)  ──ws──►  server.mjs :3000
                                                    │ ws library proxy
                                              ws://localhost:8001/ws/camera/UUID
                                                    │
                                               AR backend :8001
                                          (uvicorn + FastAPI + MediaPipe CPU)

Laptop viewer  ──ws://localhost:8001/ws/camera/UUID──►  AR backend (direct, no ngrok)
```

### Key files
| File | Role |
|---|---|
| `skillforge/server.mjs` | Custom Next.js server + ws library WebSocket proxy (**DO NOT DELETE**) |
| `skillforge/package.json` | `"dev": "node server.mjs"` (**DO NOT change to `next dev`**) |
| `skillforge/next.config.ts` | No `/ws/*` rewrite, `reactStrictMode: false` (**CRITICAL — DO NOT REVERT**) |
| `skillforge/app/live/page.tsx` | `qrUrl` hydration fix + `enabled: isCameraOnlyMode && isActive` |
| `skillforge/hooks/useCameraRoomProducer.ts` | Frame capture + reconnect logic |
| `skillforge/hooks/useCameraRoomViewer.ts` | Direct `ws://localhost:8001` (bypasses proxy) |
| `skillforge/backend/main.py` | AR backend: camera room relay + MediaPipe CPU hand detection |
| `skillforge/.env.local` | `NEXT_PUBLIC_APP_URL` + `NEXT_PUBLIC_WS_HOST` = current ngrok URL |

---

## All Fixes Applied (in order)

### Fix 1 — `next.config.ts`: Wildcard `allowedDevOrigins`
`"*.ngrok-free.app"` wildcard so any ngrok URL works without editing the file.

### Fix 2 — AR backend startup path confirmed
Must run uvicorn from `skillforge/backend/` using venv from `skillforge-api/.venv`.

### Fix 3 — `live/page.tsx`: voice commands gated on `isActive`
`enabled: !isCameraOnlyMode && isActive && micEnabled`

### Fix 4 — `server.mjs`: WebSocket proxy (ws library, v2)
Replaced raw TCP pipe with `ws` library `WebSocketServer({ noServer: true })` + `new WebSocket(arUrl)` client.
Message buffering: phone frames queued until arWs opens, flushed on `arWs.on('open')`.

### Fix 5 — `useCameraRoomViewer`: direct `ws://localhost:8001`
Laptop viewer bypasses proxy and ngrok entirely — avoids double round-trip latency.

### Fix 6 — `live/page.tsx`: QR code hydration mismatch
`useState("")` + `useEffect(() => setQrUrl(...), [remoteSessionId])` — SSR returns empty string, client fills it in. Prevents React hydration warning.

### Fix 7 — `live/page.tsx`: producer gated on `isActive`
`enabled: isCameraOnlyMode && isActive` — WebSocket only opens after camera stream is live, not during the OS permission prompt (which suspends the page and drops TCP).

### Fix 8 — `next.config.ts`: disable React Strict Mode
`reactStrictMode: false` — Strict Mode double-mounts effects in dev, causing `ws.close(1000)` during camera startup → phone sees code 1006 disconnect.

### Fix 9 — `useCameraRoomProducer.ts`: auto-reconnect + exponential backoff
On abnormal close (code ≠ 1000/1001), retries after 2s→4s→8s→16s→32s (up to 5 attempts). Uses `activeRef` to prevent reconnect after unmount.

### Fix 10 — `server.mjs`: disable perMessageDeflate
`perMessageDeflate: false` on both `WebSocketServer` and `arWs` client — iOS Safari rejects ws library's default compression extension negotiation parameters.

### Fix 11 — `server.mjs`: sanitize unsendable close codes
`arWs.on("close")` maps codes 1004/1005/1006 → 1000 before `phoneWs.close(code)` — RFC 6455 forbids sending reserved codes; ws library throws RangeError otherwise.

### Fix 12 — `useCameraRoomProducer.ts`: fix infinite reconnect loop
Removed `reconnectCountRef.current = 0` from `ws.onopen`. Previously every brief open→close cycle reset the counter, making the 5-attempt cap unreachable.

### Fix 13 — `server.mjs`: log close reason string
`phoneWs.on("close")` and `arWs.on("close")` now log `reason?.toString()` alongside the code — helps diagnose protocol errors.

### Fix 14 — `next.config.ts`: remove `/ws/:path*` rewrite ← **ROOT CAUSE FIX**
**This was the primary bug causing "Invalid frame header" / "RSV1 must be clear".**

Next.js 15/16 applies `rewrites()` to WebSocket upgrade requests as well as HTTP. The `/ws/:path*` rewrite was creating a **second simultaneous connection** to the AR backend (alongside our proxy), and that second connection negotiated perMessageDeflate compression by default. The AR backend sent RSV1=1 (compressed) frames back; our proxy forwarded them to the phone which had never negotiated compression → immediate disconnect.

Removing the rewrite leaves all `/ws/*` WebSocket handling exclusively to `server.mjs`.

**Verified:** Direct `ws://localhost:3000` test showed single connection + CLOSED:1000 clean. Chrome and iPhone both connected successfully after this fix.

### Fix 15 — AR backend: force CPU mode (`MEDIAPIPE_DELEGATE=cpu`)
**Root cause of AR backend crash:** MediaPipe GPU delegate initialises on M4 Pro without error, but crashes during the FIRST frame inference with:
`Check failed: status_or_buffer is OK (UNKNOWN: unsupported ImageFrame format: 1)`
in `gpu_buffer_storage_cv_pixel_buffer.cc`. The try/except around `create_from_options` does NOT catch this — it happens inside `detect_for_video()` at runtime.

**Fix:** Always start uvicorn with `MEDIAPIPE_DELEGATE=cpu`. This skips GPU entirely and uses stable CPU inference.

**Still pending (low priority):** Add try/except inside `process_and_broadcast()` around `run_hand_detection_video()` so a GPU crash gracefully falls back to CPU without killing the server process (safety net in case the env var is forgotten).

### Fix 16 — `server.mjs`: improve AR backend error logging
`err.message || err.code || String(err)` — `err.message` is empty string for ECONNREFUSED on Node.js v22, so the error was silently blank.

### Fix 17 — Merge `main` into `fix/camera-feed`
Merged origin/main (teammates' work) into the branch. Conflict resolutions:
- **Kept ours:** `server.mjs` (main deleted it), `package.json` dev script, `next.config.ts` core (no `/ws/` rewrite, `reactStrictMode: false`, wildcard origins), `useCameraRoomProducer.ts` reconnect logic, `live/page.tsx` hydration + isActive fixes
- **Took from main:** All `skillforge-api/**` updates, new components, improved logging in hooks, teammates' ngrok origins in `allowedDevOrigins`

### Fix 18 — Camera lag: reduce frame size and quality
Reduced from 1920×1080 JPEG 0.7 → **640×360 JPEG 0.5**:
- 1080p ≈ 250–400 KB/frame × 24fps ≈ 6–10 MB/s through ngrok (extremely laggy)
- 360p ≈ 15–35 KB/frame × 15fps ≈ 0.2–0.5 MB/s — ~20× less data
- CPU hand detection also much faster on smaller frames: ~150ms → ~30ms
- User confirmed streaming speed is noticeably improved.

### Fix 19 — Camera rotation: +90° clockwise
Phone portrait video arrives rotated 90° anti-clockwise on the laptop screen.
Changed canvas transform from `-Math.PI/2` (counter-clockwise) to `+Math.PI/2` (clockwise):
```ts
ctx.translate(CAPTURE_WIDTH, 0);  // was: translate(0, CAPTURE_HEIGHT)
ctx.rotate(Math.PI / 2);          // was: rotate(-Math.PI / 2)
```

---

## Known Remaining Issues

### M4 Pro GPU crash safety net (low priority)
The `MEDIAPIPE_DELEGATE=cpu` env var is the fix. A code-level safety net (try/except around `detect_for_video` in `process_and_broadcast`) would prevent the server dying if the env var is ever forgotten. Not urgent since the start command is documented above.

### NVIDIA GPU server (optional performance improvement)
If MediaPipe CPU inference (~30–60ms/frame at 360p) is still too slow for real-time hand detection, the AR backend can be moved to an NVIDIA GPU server:
- Set `AR_BACKEND_HOST` + `AR_BACKEND_PORT` in `server.mjs` to point at the remote server
- GPU inference: ~5–10ms vs CPU ~30–60ms — significant improvement
- Worth doing only if CPU mode lag is unacceptable after the frame size reduction
