# Camera Feed Fix — Progress Log
**Branch:** `fix/phone-camera-feed`

---

## Current Architecture

```
Phone  ──wss──►  ngrok (port 3000 tunnel)  ──http/1.1──►  server.mjs :3000
                                                                │
                                              wss.handleUpgrade() [ws library]
                                                                │
                                              ws://localhost:8001/ws/camera/UUID
                                                                │
                                                         AR backend :8001
                                                   (uvicorn + FastAPI + MediaPipe)

Laptop  ──ws://localhost:8001/ws/camera/UUID──────────────────►  AR backend :8001
         (direct, bypasses proxy and ngrok)
```

### Key files
| File | Role |
|---|---|
| `skillforge/server.mjs` | Custom Next.js server + `ws` library WebSocket proxy |
| `skillforge/app/live/page.tsx` | Main live page: QR modal, producer, viewer hooks |
| `skillforge/hooks/useCameraRoomProducer.ts` | Phone WS hook: connects, sends role, streams frames |
| `skillforge/hooks/useCameraRoomViewer.ts` | Laptop WS hook: `ws://localhost:8001` direct |
| `skillforge/backend/main.py` | AR backend: camera room relay + hand detection |
| `skillforge/.env.local` | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_WS_HOST` (ngrok URLs) |
| `skillforge/next.config.ts` | `allowedDevOrigins`, `reactStrictMode: false` |

### How to start (3 terminals)
```bash
# Terminal 1 — AR backend
cd /path/to/skillforge/skillforge/backend
/path/to/skillforge-api/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001

# Terminal 2 — Next.js
cd /path/to/skillforge/skillforge
npm run dev    # runs: node server.mjs

# Terminal 3 — ngrok (tunnels port 3000 for phone)
ngrok http 3000
# → update .env.local: NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_WS_HOST with new URL
# → restart npm run dev after updating .env.local
```

---

## Root Cause of 1006 Disconnect (Current Unresolved Issue)

### Observed log every test attempt
```
[WS proxy] Phone connected → opening AR backend: ws://localhost:8001/ws/camera/UUID
[WS proxy] AR backend open. Flushing 0 buffered frame(s)
[WS proxy] Phone closed (1006), terminating AR backend
[WS proxy] AR backend closed (1006), closing phone WS
```

### What code 1006 means
Code 1006 = **abnormal closure** — the TCP connection was dropped without a WebSocket close frame. The phone's browser did NOT call `ws.close(code)` cleanly. The TCP connection was abruptly terminated.

### What is NOT the cause (ruled out)
| Hypothesis | Status | Reason |
|---|---|---|
| Data format mismatch | ✗ Ruled out | JSON text frames correct end-to-end; AR backend protocol matches |
| Security / CORS | ✗ Ruled out | `allow_origins=["*"]`, TLS handled by ngrok, no mixed content |
| Proxy handshake | ✗ Ruled out | "Phone connected" = 101 sent successfully |
| AR backend rejecting | ✗ Ruled out | "AR backend open" = AR backend accepted connection |
| Raw TCP race condition | ✗ Fixed | Replaced with `ws` library in server.mjs v2 |
| Camera permission suspension | ✗ Addressed | Added `enabled: isCameraOnlyMode && isActive` (Fix 7) |

### Most likely cause: React Strict Mode double-mount
Next.js 15/16 defaults to `reactStrictMode: true`. In development, React runs every `useEffect` **twice**:
1. Setup → opens WebSocket (ws1)
2. Cleanup → `ws1.close(1000)` called
3. Setup again → opens WebSocket (ws2)

During step 2, on mobile browsers, `ws.close(1000)` can result in the **server seeing code 1006** because:
- The browser sends a close frame (code 1000) but immediately drops the TCP connection
- The server's `ws` library sees an incomplete close handshake → reports 1006 instead of 1000

The second connection (ws2) may not reach the proxy if the Strict Mode remount is too fast, OR if ws2 also closes abnormally.

### Fix: disable React Strict Mode + add auto-reconnect (Fix 8 + Fix 9 below)

---

## All Fixes Applied

### Fix 1 — `next.config.ts`: Wildcard `allowedDevOrigins`
- Status: ✅ Done
- `"*.ngrok-free.app"` wildcard instead of hardcoded URLs

### Fix 2 — AR backend startup path confirmed
- Status: ✅ Documented
- Must run from `skillforge/backend/` with venv from `skillforge-api/.venv`

### Fix 3 — `live/page.tsx`: voice commands gated on `isActive`
- Status: ✅ Done
- `enabled: !isCameraOnlyMode && isActive && micEnabled` (was `displayActive`)

### Fix 4 — `server.mjs`: WebSocket proxy v2 (`ws` library)
- Status: ✅ Done
- `WebSocketServer({ noServer: true })` + `new WebSocket(arUrl)` client
- Message buffering: phone frames queued until arWs opens, flushed on `arWs.on('open')`
- Full console logging: Phone connected / AR backend open / Phone closed / AR backend closed

### Fix 5 — `useCameraRoomViewer`: direct `ws://localhost:8001`
- Status: ✅ Done
- Laptop viewer bypasses proxy and ngrok entirely

### Fix 6 — `live/page.tsx`: QR code hydration mismatch
- Status: ✅ Done
- `useState("")` + `useEffect` instead of `typeof window` IIFE in JSX

### Fix 7 — `live/page.tsx`: producer gated on `isActive`
- Status: ✅ Done
- `enabled: isCameraOnlyMode && isActive`
- WebSocket only opens after camera is live (not during permission prompt)

### Fix 8 — `next.config.ts`: disable React Strict Mode
- Status: ✅ Done
- `reactStrictMode: false` — eliminates double-mount that causes 1006 in dev

### Fix 9 — `useCameraRoomProducer.ts`: auto-reconnect on abnormal close
- Status: ✅ Done
- If close code ≠ 1000/1001, retries connection after 2s (up to 5 attempts)
- Handles residual transient closes from network/ngrok

---

## Test Checklist
- [ ] `node server.mjs` starts, logs `WebSocket /ws/* proxied → ws://localhost:8001`
- [ ] AR backend running on port 8001
- [ ] Phone scans QR → grants camera → taps "Start camera"
- [ ] Server logs "Phone connected" AFTER camera starts
- [ ] Server logs "AR backend open. Flushing N buffered frame(s)"
- [ ] Phone shows "Connected" (not "Disconnected")
- [ ] Laptop QR modal shows "Phone connected"
- [ ] Phone camera feed visible on laptop canvas
- [ ] Hand landmarks render over feed
