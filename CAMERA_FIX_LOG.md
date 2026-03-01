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

### Fix 20 — `backend/main.py`: add `z` coordinate + `handedness` to landmark data ← **GESTURE DETECTION FIX**
**Root cause:** Gesture detection (pinch/double-tap) silently failed for the remote camera feed due to two missing fields in the backend's landmark output.

**Root cause A — missing `z`:** `pinch-detection.ts:toNormalized()` accesses `lm.z`. The backend only sent `{x, y}`. With `z = undefined`, `distance3d()` returns `NaN`, and `NaN < PINCH_THRESHOLD` is always `false` → pinch never detected.

**Root cause B — missing `handedness`:** `computePinchState()` skips any hand where `!handedness` (line 55). Without it, both hands are skipped → `leftPressed` and `rightPressed` always `false`.

**Fix in `run_hand_detection()` and `run_hand_detection_video()`:**
- Changed return type from `list[list[dict]]` → `list[dict]` (each dict = `{"landmarks": [...], "handedness": "Left"|"Right"|None}`)
- Added `"z": round(lm.z, 4)` to every landmark
- Extracted `handedness` from `result.handedness[i][0].display_name`
- Updated `_build_detect_response()` to pass the hand dicts through directly instead of re-wrapping

**Result:** Pinch indicator lights up, double-tap gestures trigger skip/rewind on remote camera feed.

### Fix 21 — `live/page.tsx`: voice recognition enabled in remote camera mode
**Root cause:** `useVoiceCommands` was gated on `enabled: !isCameraOnlyMode && isActive && micEnabled`. `isActive` is the local laptop camera state — always `false` when using the phone as remote camera → voice permanently disabled.

**Fix:** Changed `isActive` → `displayActive`. `displayActive` is `true` in both local (`isActive`) and remote (`!!remoteSessionId`) modes. Voice now starts listening as soon as the remote session is active.

### Fix 22 — `live/page.tsx`: mic button visible in remote camera mode
**Root cause:** The mic toggle button and its status indicator (`"Listening"` / `"Starting..."` / `"Unavailable"`) were inside `{isActive && (...)}`. In remote mode `isActive = false` → button hidden → user had no feedback that voice was running (or failing).

**Fix:** Changed gate from `{isActive && (...)}` → `{displayActive && (...)}` on the mic button only. The gesture toggle remains on `{isActive && ...}` since gesture detection works correctly in remote mode without a toggle (gestures are always enabled via `gesturesEnabled = true` default).

### Fix 23 — Merge `origin/main` into `fix/camera-feed` (second merge)
Main had 14 new commits (`8dc3ba8`) that broke 5 critical camera fixes:
- `server.mjs` **deleted** in main → restored from our branch
- `next.config.ts`: main re-added `/ws/:path*` rewrite (root cause of Fix 14) + removed `reactStrictMode: false` + dropped wildcard origins → kept our version
- `package.json`: main reverted `dev` to `next dev` → kept our `node server.mjs`
- `useCameraRoomProducer.ts`: main reverted to 1080p + re-added -90° rotation + removed reconnect → kept our version
- `live/page.tsx`: main removed `isActive` gate + removed QR hydration fix → kept our version

New features taken from main:
- `useVoiceCommands`: `requireUserGesture`, `displayTranscript`, `startListening`, `onElaborate`
- `useDoubleTapDetection`: moved logic to `useEffect` (avoids setState-during-render)
- Backend additions: `trainee.py`, `voice.py`, `asr_service.py`, new services
- Player components: `StepTimelineVertical`, `StepHistoryPanel`, `SubtitleOverlay`

---

### Fix 24 — Integrate phone camera into trainer recording (`session/page.tsx`) + trainee learning (`LearnView.tsx`)
**Strategy A:** Phone camera is a detection/preview source only. Laptop webcam still records step videos — recording pipeline unchanged.

**New shared files:**
- `skillforge/hooks/usePhoneCameraSession.ts` — encapsulates session ID generation, QR URL (useEffect pattern matching `live/page.tsx`), `useCameraRoomViewer` integration. Exposes `startRemoteSession()`, `stopRemoteSession()`, `remoteSessionId`, `qrUrl`, `viewerStatus`, `remoteFrame`, `remoteDetection`, `isPhoneConnected`.
- `skillforge/components/camera/PhoneCameraQRModal.tsx` — shared full-screen overlay modal with QR code, connection status, Done/Close button. Used by both trainer and trainee pages.

**Trainer recording page (`session/page.tsx`):**
- Added `usePhoneCameraSession()` hook
- `activeHands = phone.isPhoneConnected ? phone.remoteDetection.hands : handData` — phone hands used for gesture/double-tap detection when phone is connected
- `computePinchState(activeHands)` and `useDoubleTapDetection(gesturesEnabled ? activeHands : null, ...)` use merged hands
- "Phone cam" button added to top-left toolbar bar (alongside mic, gesture, subtitle toggles) — clicking starts phone session + shows QR modal
- Phone PiP preview shown at bottom-right (160px wide `<img>` with live base64 JPEG frames, click to re-open QR modal)
- QR modal rendered at end of JSX
- `phone.stopRemoteSession()` called on exit

**Trainee learning view (`LearnView.tsx`):**
- Added `usePhoneCameraSession()` hook
- `activeHands = phone.isPhoneConnected ? phone.remoteDetection.hands : isTrainingMode ? cameraHands : null` — gestures work from phone even without training mode
- `useDoubleTapDetection(activeHands, ...)` — double-tap navigation works from phone
- `useMediaPipeDetect` disabled when phone connected (avoid conflicting local detections)
- `checkStepSuggest` polling: uses `phoneFrameRef.current.data` (latest phone frame) when phone is connected; falls back to local camera canvas capture otherwise
- Polling runs when `phone.isPhoneConnected` OR local training mode + camera — no training mode required for phone
- RAF canvas overlay loop skipped when phone is connected (phone shows `<img>`, not local video)
- "Phone cam" button added to header bar alongside "Start training"
- Camera panel shown when `isTrainingMode || phone.isPhoneConnected`; shows live phone frames (`<img>`) when phone connected, local video+canvas when not
- Layout splits to w-1/2 / w-1/2 when `isTrainingMode || phone.isPhoneConnected`
- QR modal rendered at end of JSX

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
