# Camera Feed Fix — Progress Log
**Branch:** `fix/camera-feed`

---

## ✅ CAMERA IS FULLY WORKING

Phone camera streams to laptop, hand detection overlay renders, rotation is correct, lag is acceptable. All critical issues resolved.

---

## How to start every session (3 terminals)

```bash
# Terminal 1 — AR backend  ← MEDIAPIPE_DELEGATE=cpu is REQUIRED
cd skillforge/skillforge/backend
MEDIAPIPE_DELEGATE=cpu skillforge-api/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001

# Terminal 2 — Next.js (must use node server.mjs, NOT next dev)
cd skillforge/skillforge
npm run dev

# Terminal 3 — ngrok
ngrok http 3000
# After ngrok starts: update skillforge/.env.local with new URLs:
#   NEXT_PUBLIC_APP_URL=https://<new-id>.ngrok-free.app
#   NEXT_PUBLIC_WS_HOST=<new-id>.ngrok-free.app
# Then restart Terminal 2 (npm run dev) to load the new env vars
```

**On laptop:** open `http://localhost:3000/live`
**On phone:** scan QR code → grant camera → tap "Start camera"

---

## Architecture

```
Phone  ──wss──►  ngrok :443  ──ws──►  server.mjs :3000  ──ws──►  AR backend :8001
                                      (ws library proxy)          (MediaPipe CPU)

Laptop viewer  ──ws://localhost:8001──►  AR backend :8001  (direct, no ngrok hop)
```

---

## Critical Rules — DO NOT BREAK

| Rule | Why |
|---|---|
| `server.mjs` must exist | It is the entire WebSocket proxy. Main deleted it — always restore. |
| `package.json` dev = `node server.mjs` | `next dev` skips the proxy; phone can never connect. |
| No `/ws/:path*` rewrite in `next.config.ts` | Next.js 15/16 applies rewrites to WS upgrades too → double connection → RSV1 compressed frames → "Invalid frame header" crash |
| `reactStrictMode: false` | Strict Mode double-mounts effects → double open→close → 1006 on mobile |
| `MEDIAPIPE_DELEGATE=cpu` at startup | GPU init succeeds on M4 Pro but crashes at first inference (C-level SIGABRT, uncatchable) |

---

## Key Files

| File | Role |
|---|---|
| `skillforge/server.mjs` | Custom Next.js server + ws library WebSocket proxy |
| `skillforge/package.json` | `"dev": "node server.mjs"` |
| `skillforge/next.config.ts` | `reactStrictMode: false`, wildcard `allowedDevOrigins`, NO `/ws/` rewrite |
| `skillforge/app/live/page.tsx` | `qrUrl` hydration fix + `enabled: isCameraOnlyMode && isActive` |
| `skillforge/hooks/useCameraRoomProducer.ts` | Frame capture (640×360, JPEG 0.5, 24fps) + reconnect logic |
| `skillforge/hooks/useCameraRoomViewer.ts` | Direct `ws://localhost:8001` (bypasses proxy) |
| `skillforge/backend/main.py` | AR backend: camera room relay + MediaPipe hand detection |
| `skillforge/.env.local` | `NEXT_PUBLIC_APP_URL` + `NEXT_PUBLIC_WS_HOST` = current ngrok URL |

---

## Complete Fix History

### Fix 1 — `next.config.ts`: wildcard `allowedDevOrigins`
`"*.ngrok-free.app"` wildcard so any ngrok URL works without editing the file each session.

### Fix 2 — AR backend startup path
Must `cd skillforge/backend` before running uvicorn. Venv is at `skillforge-api/.venv`.

### Fix 3 — `live/page.tsx`: voice commands gated on `isActive`
`enabled: !isCameraOnlyMode && isActive && micEnabled`

### Fix 4 — `server.mjs`: WebSocket proxy (ws library)
Replaced raw TCP pipe with proper ws library proxy:
- `WebSocketServer({ noServer: true, perMessageDeflate: false })` handles phone connection
- `new WebSocket(arUrl, { perMessageDeflate: false })` connects to AR backend
- Buffers phone frames while AR backend WS is opening; flushes on `arWs.on("open")`
- Symmetric close/error handling in both directions

### Fix 5 — `useCameraRoomViewer.ts`: direct `ws://localhost:8001`
Laptop viewer bypasses proxy and ngrok entirely — no double latency.

### Fix 6 — `live/page.tsx`: QR code hydration mismatch
`useState("")` + `useEffect(() => setQrUrl(...), [remoteSessionId])`. SSR returns empty string, client fills it in. Prevents React hydration warning.

### Fix 7 — `live/page.tsx`: producer gated on `isActive`
`enabled: isCameraOnlyMode && isActive` — WebSocket only opens after camera stream is live. Opening during OS permission prompt suspends the page, drops TCP → 1006.

### Fix 8 — `next.config.ts`: `reactStrictMode: false`
Strict Mode double-mounts effects in dev. The cleanup `ws.close(1000)` on mobile drops TCP before server ACKs → server sees 1006 instead of 1000 → phone shows "Disconnected".

### Fix 9 — `useCameraRoomProducer.ts`: auto-reconnect + exponential backoff
On abnormal close (code ≠ 1000/1001): retries after 2s→4s→8s→16s→32s (max 5 attempts). `activeRef` prevents reconnect after unmount. Counter does NOT reset on `onopen` (that was the infinite-loop bug).

### Fix 10 — `server.mjs`: `perMessageDeflate: false`
Both `WebSocketServer` and `arWs` client. iOS Safari (and ws library client) reject the default permessage-deflate extension negotiation → immediate 1002 close.

### Fix 11 — `server.mjs`: sanitize unsendable close codes
`arWs.on("close")` maps 1004/1005/1006 → 1000 before `phoneWs.close(code)`. RFC 6455 §7.4.2 forbids sending reserved codes; ws library throws `RangeError`.

### Fix 12 — `useCameraRoomProducer.ts`: fix infinite reconnect loop
Removed `reconnectCountRef.current = 0` from `ws.onopen`. Previously, every successful open reset the counter → 5-attempt cap was never reached → infinite loop.

### Fix 13 — `server.mjs`: log close reason string
`reason?.toString() || "(none)"` alongside close code. Helped diagnose the 1002 issue.

### Fix 14 — `next.config.ts`: remove `/ws/:path*` rewrite ← **ROOT CAUSE**
**This fixed the "Invalid frame header" / "RSV1 must be clear" crash.**

Next.js 15/16 applies `rewrites()` to WebSocket upgrades as well as HTTP requests. The `/ws/:path*` rewrite caused Next.js to open a SECOND WebSocket connection to the AR backend (alongside our proxy), with perMessageDeflate compression enabled by default. The AR backend sent RSV1=1 compressed frames through this second connection; our proxy forwarded them to the phone, which had never negotiated compression → "RSV1 must be clear" → 1006 crash.

Diagnostic command that confirmed it:
```js
// Chrome DevTools console — showed "Invalid WebSocket frame: RSV1 must be clear"
const ws = new WebSocket("ws://localhost:3000/ws/camera/test");
ws.onopen = () => ws.send(JSON.stringify({role:"producer"}));
ws.onerror = e => console.log("error", e);
ws.onclose = e => console.log("closed", e.code);
```
Also confirmed by AR backend log showing TWO simultaneous accepted connections per phone connect.

After removing the rewrite: one connection, CLOSED:1000 clean.

### Fix 15 — AR backend: `MEDIAPIPE_DELEGATE=cpu` ← **M4 PRO GPU CRASH FIX**
**Root cause:** MediaPipe GPU delegate (`create_from_options` with `Delegate.GPU`) initialises without error on M4 Pro, so the code thinks GPU is available. But on the FIRST frame inference (`detect_for_video()`), MediaPipe's internal C++ code crashes with a fatal `CHECK` failure:
```
F0000 gpu_buffer_storage_cv_pixel_buffer.cc:154] Check failed: status_or_buffer is OK
(UNKNOWN: unsupported ImageFrame format: 1)
```
This is a **C-level SIGABRT** — it bypasses Python entirely and kills the uvicorn process. It CANNOT be caught with `try/except`. The `try/except` around `create_from_options` in `_get_hand_landmarker_video()` does not help because the crash happens inside `detect_for_video()`, not during initialization.

**Fix:** `MEDIAPIPE_DELEGATE=cpu` env var → `try_cpu_only = True` → GPU code path skipped entirely. CPU inference is stable and ~30–60ms/frame at 640×360.

**Why no code fix helps:** A C-level `abort()` cannot be caught in Python. The only code-level alternative would be running detection in a separate subprocess (complex). The env var approach is the correct solution.

### Fix 16 — `server.mjs`: improve AR backend error logging
`err.message || err.code || String(err)` — `err.message` is empty string for ECONNREFUSED on Node.js v22.

### Fix 17 — Merge `main` into `fix/camera-feed`
Merged teammates' work (apparatus pipeline, SAM3 client, new components, etc.) into our branch. All camera-critical files protected. Key conflict resolutions:
- **Kept ours:** `server.mjs`, `package.json` dev script, `next.config.ts` (no `/ws/` rewrite, `reactStrictMode: false`, wildcard origins), `useCameraRoomProducer.ts` reconnect logic, `live/page.tsx` hydration + `isActive` fixes
- **Took from main:** All `skillforge-api/**`, new components, improved hook logging, teammates' ngrok origins in `allowedDevOrigins`

### Fix 18 — `useCameraRoomProducer.ts`: reduce frame size for lower latency
`1920×1080 JPEG 0.7` → `640×360 JPEG 0.5`
- Before: ~250–400 KB/frame × 24fps ≈ 6–10 MB/s through ngrok → extreme lag
- After: ~15–35 KB/frame × 24fps ≈ 0.4–0.8 MB/s → ~20× less data, much faster
- CPU inference time also drops: ~150ms → ~30ms on smaller frames
- User confirmed: "the speed of the camera is much better than before"

### Fix 19 — `useCameraRoomProducer.ts`: remove canvas rotation
Removed the `-90°` rotation transform. Phone camera video is already correctly oriented — the rotation was causing the feed to appear rotated on the laptop.
Final code: `ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)` — no transform.

---

## Remaining Tasks (optional improvements)

### NVIDIA GPU server for faster inference (optional)
CPU inference at 640×360 is ~30–60ms/frame. If real-time hand detection needs to be faster:
1. Run `MEDIAPIPE_DELEGATE=gpu uvicorn main:app ...` on an NVIDIA CUDA server
2. In `server.mjs`, change `AR_BACKEND_HOST` and `AR_BACKEND_PORT` to point at the remote server
3. GPU inference: ~5–10ms/frame vs CPU ~30–60ms — significant improvement
4. Net win only if SSH tunnel latency < ~50ms

### `ws` package not in `package.json` dependencies
`server.mjs` imports from `ws` library but it's not listed in `skillforge/package.json`. It currently works as a transitive dependency (pulled in by Next.js). Should be added explicitly:
```bash
cd skillforge && npm install ws
```
