# Camera Feed Merge Guide — `fix/camera-feed` → `main`

> **For:** Teammate agent performing the merge
> **Branch to merge FROM:** `fix/camera-feed`
> **Branch to merge INTO:** `main`
> **Date written:** 2026-03-01
> **Full fix history:** See `CAMERA_FIX_LOG.md`

---

## ⚠️ CRITICAL: Read This Before Merging

This branch contains **25 carefully sequenced fixes** to make the phone camera feed work end-to-end. Several of these fixes directly counteract patterns that exist (or have repeatedly appeared) in `main`. If you resolve merge conflicts by blindly taking `main`'s version, the camera will break silently.

**The 6 files that MUST come from `fix/camera-feed`** (never take `main`'s version):

| File | Why `main`'s version breaks everything |
|---|---|
| `skillforge/server.mjs` | `main` deleted this file. It is the entire WebSocket proxy. Without it, the phone can never connect. |
| `skillforge/package.json` | `main` uses `"dev": "next dev"`. Must be `"dev": "node server.mjs"`. |
| `skillforge/next.config.ts` | `main` has a `/ws/:path*` rewrite (root cause of RSV1 crash) and `reactStrictMode: true` (causes 1006 on mobile). |
| `skillforge/hooks/useCameraRoomProducer.ts` | `main` uses 1080p + canvas rotation + no reconnect logic. |
| `skillforge/hooks/useCameraRoomViewer.ts` | `main` uses an indirect URL helper that can route through ngrok (double-latency). |
| `skillforge/app/live/page.tsx` | `main` has `enabled: isCameraOnlyMode` (no `isActive` gate) and inline `typeof window` in QR JSX (hydration crash). |

---

## Merge Command

```bash
# From inside the repo root
git checkout main
git fetch origin
git merge origin/fix/camera-feed --no-ff -m "merge: integrate fix/camera-feed — phone camera + PiP recording"
```

When conflicts arise, use the resolution rules in the section below for each file.

---

## File-by-File Conflict Resolution Rules

### 1. `skillforge/server.mjs` — **ALWAYS take `fix/camera-feed`**

`main` does not have this file. It must exist. If there is a conflict (unlikely since `main` deleted it), restore it from our branch:

```bash
git checkout fix/camera-feed -- skillforge/server.mjs
```

**What it does:** Custom Next.js HTTP server that intercepts WebSocket upgrade requests for `/ws/*` paths and proxies them to the AR backend at `localhost:8001`. Uses the `ws` library (not raw TCP). Key properties:
- `perMessageDeflate: false` on both the `WebSocketServer` and the outbound `arWs` — iOS Safari rejects the default permessage-deflate negotiation and closes with code 1002
- Buffers phone frames in `pendingToAR[]` while the AR backend WS is opening — prevents the role-message race that dropped the first frame and caused 1006
- Maps unsendable close codes (1004/1005/1006) → 1000 before forwarding — RFC 6455 forbids sending these; the ws library throws `RangeError`
- Leaves non-`/ws/` upgrade events for Next.js HMR to handle

### 2. `skillforge/package.json` — **ALWAYS take `fix/camera-feed` for `dev` script**

```json
"dev": "node server.mjs"
```

Do NOT let this become `"next dev"`. `next dev` skips `server.mjs` entirely — the WebSocket proxy never runs, the phone can never connect.

For other fields (dependencies, etc.) take the union — add any new packages from `main` but keep the script unchanged.

### 3. `skillforge/next.config.ts` — **ALWAYS take `fix/camera-feed` for these three things**

**a) `reactStrictMode: false`** — Must remain. React Strict Mode double-mounts effects in dev. The cleanup `ws.close(1000)` on mobile drops TCP before the server ACKs → server sees 1006 → phone shows "Disconnected".

**b) No `/ws/:path*` rewrite** — `main` keeps re-adding this. It MUST NOT exist. Next.js 15/16 applies `rewrites()` to WebSocket upgrades too. This caused Next.js to open a second WebSocket to the AR backend (alongside our proxy), with `perMessageDeflate` enabled by default. The AR backend sent RSV1=1 compressed frames through this second connection; our proxy forwarded them to the phone which had never negotiated compression → "RSV1 must be clear" / "Invalid frame header" → 1006 crash.

**c) Wildcard `allowedDevOrigins`** — Must include `"*.ngrok-free.app"` and `"*.ngrok-free.dev"` so any ngrok URL works without editing the file each session.

The correctly merged file must contain:
```ts
const nextConfig: NextConfig = {
  reactStrictMode: false,
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    // ... any team-specific origins from main are fine to keep ...
  ],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:8000/:path*" },
      { source: "/api/python/:path*", destination: "http://localhost:8000/api/:path*" },
      // NOTE: NO /ws/:path* rewrite — server.mjs handles WebSocket upgrades directly
    ];
  },
  // ...
};
```

### 4. `skillforge/hooks/useCameraRoomProducer.ts` — **ALWAYS take `fix/camera-feed`**

Key differences from `main`:

**a) Frame size: 640×360 @ JPEG 0.5** (not 1080p @ 0.7)
```ts
const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 360;
const JPEG_QUALITY = 0.5;
```
1080p was ~250–400 KB/frame × 24fps ≈ 6–10 MB/s through ngrok → extreme lag. 360p is ~15–35 KB/frame ≈ 0.4–0.8 MB/s → ~20× less data, ~50ms latency.

**b) No canvas rotation** — `main` had `-90°` rotation. Phone video is already correctly oriented. The rotation was wrong.
```ts
ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT); // no transform
```

**c) Auto-reconnect with exponential backoff** — On abnormal close (code ≠ 1000/1001): retries after 2s, 4s, 8s, 16s, 32s (max 5 attempts). `activeRef` prevents reconnect after unmount. The reconnect counter does NOT reset on `onopen` (that would cause an infinite-reconnect loop).

### 5. `skillforge/hooks/useCameraRoomViewer.ts` — **ALWAYS take `fix/camera-feed`**

```ts
const url = `ws://localhost:8001/ws/camera/${sessionId}`;
```

`main` uses a `CAMERA_ROOM_WS()` helper that can route through ngrok or the configured WS host. The viewer always runs on the laptop — it must connect directly to `localhost:8001`, bypassing the proxy and ngrok entirely. Browsers allow `ws://localhost` from `https://` pages via the loopback mixed-content exception.

### 6. `skillforge/app/live/page.tsx` — **Take `fix/camera-feed` base, then apply `main`'s new features on top**

Critical fixes that must be preserved:

**a) Producer gated on `isActive`:**
```tsx
enabled: isCameraOnlyMode && isActive,
```
(NOT `enabled: isCameraOnlyMode`). Opening before camera permission is granted suspends the page → TCP drop → code 1006.

**b) QR URL computed in `useEffect` (not inline JSX):**
```tsx
const [qrUrl, setQrUrl] = useState<string>("");
useEffect(() => {
  if (!remoteSessionId) { setQrUrl(""); return; }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  ...
  setQrUrl(`${appUrl}/live?mode=camera&session=${remoteSessionId}&host=...`);
}, [remoteSessionId]);
```
`typeof window !== "undefined"` inside JSX causes React hydration mismatch — SSR returns "" but client returns the full URL → React warning and broken QR code.

**c) Voice commands gated on `!isCameraOnlyMode`:**
```tsx
enabled: !isCameraOnlyMode && displayActive && micEnabled,
```

**d) Mic button visible when `displayActive` (not just `isActive`):**
```tsx
{displayActive && ( <button ...mic toggle... /> )}
```
`isActive` is the local laptop camera state — always false in phone-only mode → mic button was hidden.

### 7. `skillforge/backend/main.py` — **Take `fix/camera-feed`; carefully merge new features from `main`**

Critical fix that must be preserved:

**Landmark data format: must include `z` and `handedness`:**
```python
# Each hand dict:
{"landmarks": [{"x": ..., "y": ..., "z": ...}, ...], "handedness": "Left" | "Right" | None}
```

Before this fix, the backend sent `{"x", "y"}` only. Two failures:
- `z = undefined` → `distance3d()` returns `NaN` → `NaN < PINCH_THRESHOLD` is always `false` → pinch never detected
- `handedness` missing → `computePinchState()` skips all hands → gestures dead

Both `run_hand_detection()` and `run_hand_detection_video()` must return `list[dict]` (not `list[list[dict]]`).

**MEDIAPIPE_DELEGATE=cpu** — Must be set at startup (see "How to Start" below). GPU init on M4 Pro succeeds but crashes at first `detect_for_video()` inference with a C-level SIGABRT — uncatchable in Python.

If `main` has new backend features (new endpoints, services, etc.), merge them in additively — do NOT replace our changes to `run_hand_detection` and `run_hand_detection_video`.

---

## New Files Added in `fix/camera-feed` (take all of them, no conflicts)

These files don't exist in `main` — just accept them:

| File | What it does |
|---|---|
| `skillforge/hooks/usePhoneCameraSession.ts` | Shared hook — session ID generation, QR URL, wraps `useCameraRoomViewer`. Exposes `startRemoteSession()`, `stopRemoteSession()`, `remoteFrame`, `remoteDetection`, `isPhoneConnected`, `qrUrl`, `viewerStatus`. |
| `skillforge/hooks/usePhoneVideoRecorder.ts` | Mirrors `useWebcamRecorder` exactly. Draws phone JPEG frames onto a 640×360 canvas, uses `canvas.captureStream(24)` as the video track, gets laptop mic via `getUserMedia({audio, video:false})`. Same `start/stop/snapshot/pause/resume/getDurationMs` API — drop-in replacement. |
| `skillforge/components/camera/PhoneCameraQRModal.tsx` | Full-screen QR overlay modal. Props: `qrUrl`, `viewerStatus`, `isPhoneConnected`, `onClose`. Auto-close is handled externally by a `useEffect` in the parent. |

---

## Modified Files: `session/page.tsx` and `LearnView.tsx`

These files will have significant conflicts because both branches heavily modified them. Resolution strategy:

### `skillforge/app/record/(expert)/session/page.tsx`

Take `fix/camera-feed`'s version as the base. From `main`, additively merge any new features (new session states, UI components, etc.) that don't touch the camera/recording pipeline.

**New features in `fix/camera-feed` that must be preserved:**

1. **Phone camera PiP in top bar** — "Phone cam"/"Stop phone" button, auto-close QR on connect, `showPhoneModal` state, `PhoneCameraQRModal` at JSX end.

2. **`usePhoneCameraSession()` hook** — `phone.remoteFrame`, `phone.remoteDetection`, `phone.isPhoneConnected`.

3. **`usePhoneVideoRecorder()` hook** — `phoneRecorder`, tied to `phone.remoteFrame` and enabled only in phone recording mode.

4. **`recordingSource: "laptop" | "phone"` state** — default `"laptop"`. Determines which recorder is active.

5. **`sourceLocked = useRef(false)`** — set `true` after first `snapshot()` call; prevents mid-session source switching.

6. **`activeRecorder`** — computed alias: `recordingSource === "phone" ? phoneRecorder : webcamRecorder`. ALL snapshot/stop/duration/pause/resume calls go through `activeRecorder`.

7. **`activeHands`** — merged hands: phone AR-backend hands in phone mode, local MediaPipe hands in laptop mode.

8. **`pinchState = computePinchState(activeHands)`** — uses merged hands (not `handData` directly).

9. **`laptopPipVideoRef`** — stable `useRef<HTMLVideoElement>` for the laptop PiP `<video>` element. Attached via `useEffect([webcamRecorder.stream, recordingSource])` — NOT via inline ref callback (that causes flickering at 24fps).

10. **`handleSwitchToPhone` / `handleSwitchToLaptop`** — guarded by `sourceLocked.current`.

11. **Source-switch banner** — shown during `sessionState === "apparatus_showcase"`. Floating pill above control bar showing current source + switch button.

12. **Smart PiP section** — in phone mode: laptop `<video>` PiP (amber border, click to switch back). In laptop mode: phone `<img>` PiP (green border, click to switch to phone). Both dim + disable click when locked.

13. **`recordingSourceRef` + `phoneDetectionRef`** — stable refs used inside RAF `renderLoop` (which has `[]` deps) to read latest `recordingSource` and `phone.remoteDetection` without stale closures.

14. **Canvas render loop** — draws phone AR-backend hands in phone mode, MediaPipe hands in laptop mode.

15. **`useMediaPipeDetect` gated on `recordingSource === "laptop"`** — skips local detection in phone mode.

16. **`handleConfirmFinish` dependency array**: `[activeRecorder, webcamRecorder, recordingSource, phoneRecorder, currentStepNumber, pushUploadLog]`.

### `skillforge/components/player/LearnView.tsx`

> ⚠️ **Status: IMPLEMENTED but not yet user-tested.** The code compiles cleanly but the full phone-camera trainee workflow has not been verified end-to-end. Test before shipping.

New features added (preserved from `fix/camera-feed`):

1. **`usePhoneCameraSession()` hook** — `phone.*` same as trainer page.
2. **"Phone cam"/"Stop phone" button** — in header alongside "Start training".
3. **`showPhoneModal` state** — auto-closes when `phone.isPhoneConnected`.
4. **`activeHands`** — phone hands when connected, else local `cameraHands` in training mode.
5. **`useDoubleTapDetection(activeHands, ...)`** — double-tap navigation works from phone even without training mode.
6. **`useMediaPipeDetect` disabled when phone connected** — `enabled: isTrainingMode && !!cameraStream && !phone.isPhoneConnected`.
7. **`checkStepSuggest` polling** — uses `phoneFrameRef.current.data` when phone connected; falls back to local canvas capture.
8. **Camera panel** — shown when `isTrainingMode || phone.isPhoneConnected`. Shows phone `<img>` feed when phone connected, local video+canvas otherwise.
9. **Layout** — splits to `w-1/2 / w-1/2` when `isTrainingMode || phone.isPhoneConnected`.
10. **RAF overlay loop** — skipped when phone is connected (phone shows `<img>`, not local video).
11. **`PhoneCameraQRModal`** — rendered at end of JSX.

---

## How to Start (3 Terminals — Required Every Session)

```bash
# Terminal 1 — AR backend  ← MEDIAPIPE_DELEGATE=cpu is REQUIRED on M4 Mac
cd skillforge/skillforge/backend
MEDIAPIPE_DELEGATE=cpu skillforge-api/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001

# Terminal 2 — Next.js (MUST be node server.mjs, NOT next dev)
cd skillforge/skillforge
npm run dev

# Terminal 3 — ngrok (required so phone can reach laptop)
ngrok http 3000
# After ngrok starts:
# 1. Copy the https://<id>.ngrok-free.app URL
# 2. Update skillforge/skillforge/.env.local:
#    NEXT_PUBLIC_APP_URL=https://<id>.ngrok-free.app
#    NEXT_PUBLIC_WS_HOST=<id>.ngrok-free.app
# 3. Restart Terminal 2 (npm run dev) to load the new env vars
```

**On laptop:** open `http://localhost:3000/live`
**On phone:** scan QR code → grant camera permission → tap "Start camera"

---

## Architecture Diagram

```
Phone  ──wss──►  ngrok :443  ──ws──►  server.mjs :3000  ──ws──►  AR backend :8001
                                       (ws library proxy)         (MediaPipe CPU)

Laptop viewer  ──ws://localhost:8001──►  AR backend :8001  (direct, bypasses proxy+ngrok)
```

---

## Why MEDIAPIPE_DELEGATE=cpu Is Required

GPU init (`create_from_options` with `Delegate.GPU`) succeeds on M4 Pro — no error is thrown. But on the **first frame inference** (`detect_for_video()`), MediaPipe's internal C++ code crashes:

```
F0000 gpu_buffer_storage_cv_pixel_buffer.cc:154] Check failed: status_or_buffer is OK
(UNKNOWN: unsupported ImageFrame format: 1)
```

This is a **C-level SIGABRT** that bypasses Python entirely and kills the uvicorn process. It cannot be caught with `try/except`. The only solution is `MEDIAPIPE_DELEGATE=cpu` which skips the GPU code path. CPU inference is stable at ~30–60ms/frame at 640×360.

---

## Critical Rules — DO NOT Break After Merge

| Rule | If broken |
|---|---|
| `server.mjs` must exist | Phone can never connect |
| `"dev": "node server.mjs"` in `package.json` | WebSocket proxy never runs |
| No `/ws/:path*` rewrite in `next.config.ts` | RSV1 "Invalid frame header" crash, 1006 |
| `reactStrictMode: false` | 1006 on mobile (double-mount cleanup) |
| `MEDIAPIPE_DELEGATE=cpu` at startup | C-level SIGABRT kills uvicorn on M4 |
| `useCameraRoomViewer` uses `ws://localhost:8001` | Double latency through ngrok |
| Producer `enabled: isCameraOnlyMode && isActive` | 1006 on mobile (permission prompt race) |
| QR URL in `useEffect` not inline JSX | React hydration mismatch, broken QR |
| Backend landmarks include `{x, y, z}` + `handedness` | Pinch/gesture detection dead |

---

## Testing Checklist After Merge

### Trainer Recording (`/record/session`)
- [ ] Session page loads without errors
- [ ] Laptop webcam starts and shows in main view
- [ ] "Phone cam" button appears in top bar
- [ ] Clicking "Phone cam" shows QR code modal
- [ ] Phone scanning QR → connecting → QR modal auto-closes
- [ ] Phone PiP shows in top bar (green border, "PHONE ⇄" label)
- [ ] Clicking phone PiP → phone becomes main view, laptop becomes PiP (amber border)
- [ ] Source-switch banner visible during apparatus showcase
- [ ] Pinch gestures work from phone (left/right PinchIndicator lights up)
- [ ] Double-tap gestures advance steps from phone
- [ ] Voice commands work in phone mode
- [ ] Recording → step snapshot → new step starts (no video gap)
- [ ] Source locked after first step (PiP border dims, click disabled)
- [ ] Finish → upload completes → processing page

### Phone Live View (`/live`)
- [ ] Page loads without hydration errors
- [ ] Camera-only mode: QR shows on laptop, phone connects
- [ ] Hand detection overlay renders on phone feed
- [ ] Mic button visible and toggleable in phone-connected mode

### Trainee Learning (`LearnView`) — ⚠️ Untested
- [ ] "Phone cam" button appears in learning view header
- [ ] QR modal shows and auto-closes on connect
- [ ] Phone `<img>` feed shows in camera panel
- [ ] Layout splits 50/50 when phone connected
- [ ] Double-tap navigation works from phone gestures
- [ ] Step suggestion polling uses phone frame data
- [ ] Local MediaPipe detection paused when phone connected
- [ ] "Stop phone" disconnects cleanly

---

## Summary of All 25 Fixes

See `CAMERA_FIX_LOG.md` for the full detailed history. In brief:

| Fix | What | File(s) |
|---|---|---|
| 1 | Wildcard `allowedDevOrigins` | `next.config.ts` |
| 2 | AR backend startup path | `backend/main.py` |
| 3 | Voice commands gated on `isActive` | `live/page.tsx` |
| 4 | WebSocket proxy (ws library, proper handshake, frame buffering) | `server.mjs` |
| 5 | Viewer connects directly to `ws://localhost:8001` | `useCameraRoomViewer.ts` |
| 6 | QR URL computed in `useEffect` (not inline JSX) | `live/page.tsx` |
| 7 | Producer gated on `isActive` | `live/page.tsx` |
| 8 | `reactStrictMode: false` | `next.config.ts` |
| 9 | Auto-reconnect + exponential backoff | `useCameraRoomProducer.ts` |
| 10 | `perMessageDeflate: false` (iOS 1002 fix) | `server.mjs` |
| 11 | Sanitise unsendable close codes (1004/1005/1006 → 1000) | `server.mjs` |
| 12 | Fix infinite reconnect loop (don't reset counter on `onopen`) | `useCameraRoomProducer.ts` |
| 13 | Log close reason string | `server.mjs` |
| 14 | Remove `/ws/:path*` rewrite ← **ROOT CAUSE of RSV1 crash** | `next.config.ts` |
| 15 | `MEDIAPIPE_DELEGATE=cpu` ← **M4 Pro GPU SIGABRT fix** | `backend/main.py` startup |
| 16 | Improve AR backend error logging | `server.mjs` |
| 17 | First merge of `main` into branch | all |
| 18 | Reduce frame size 1080p → 360p, quality 0.7 → 0.5 | `useCameraRoomProducer.ts` |
| 19 | Remove canvas rotation (was wrong -90°) | `useCameraRoomProducer.ts` |
| 20 | Add `z` + `handedness` to landmark data | `backend/main.py` |
| 21 | Voice recognition enabled in remote camera mode | `live/page.tsx` |
| 22 | Mic button visible in remote camera mode | `live/page.tsx` |
| 23 | Second merge of `main` into branch | all |
| 24 | Phone camera PiP integration in trainer + trainee | `session/page.tsx`, `LearnView.tsx`, new hooks+modal |
| 25 | Phone-as-primary-recorder: source switching, PiP swap, source banner, stable refs | `session/page.tsx`, `usePhoneVideoRecorder.ts` |
