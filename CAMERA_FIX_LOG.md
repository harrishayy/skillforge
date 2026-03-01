# Camera Feed Fix — Progress Log
**Branch:** `fix/camera-feed`

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
| `skillforge/lib/constants.ts` | `CAMERA_ROOM_WS()` — builds wss:// URL using NEXT_PUBLIC_WS_HOST |
| `skillforge/next.config.ts` | `allowedDevOrigins`, `reactStrictMode: false` |

### How to start (3 terminals)
```bash
# Terminal 1 — AR backend
cd /path/to/skillforge/skillforge/backend
/path/to/skillforge/skillforge-api/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001

# Terminal 2 — Next.js
cd /path/to/skillforge/skillforge
npm run dev    # runs: node server.mjs

# Terminal 3 — ngrok (tunnels port 3000 for phone)
ngrok http 3000
# → update .env.local: NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_WS_HOST with new URL
# → restart npm run dev after updating .env.local
```

---

## Current Unresolved Issue: Code 1002 (Protocol Error)

### Observed log — repeats in a loop
```
[WS proxy] Phone connected → opening AR backend: ws://localhost:8001/ws/camera/UUID
[WS proxy] AR backend open. Flushing 0 buffered frame(s)
[WS proxy] Phone closed (1002) reason: "(unknown — reason string not previously logged)"
[WS proxy] AR backend closed (1006), closing phone WS
```

### What code 1002 means
Code 1002 = **Protocol Error** — the phone's browser (iOS Safari) received a WebSocket frame or handshake response it could not process. This is different from 1006 (TCP drop): 1002 is an active close by Safari saying "something you sent me was invalid."

### What is NOT the cause (ruled out)
| Hypothesis | Status | Reason |
|---|---|---|
| Data format mismatch | ✗ Ruled out | JSON text frames correct end-to-end |
| Security / CORS | ✗ Ruled out | `allow_origins=["*"]`, TLS via ngrok |
| Proxy handshake (101) | ✗ Ruled out | "Phone connected" = 101 sent successfully |
| AR backend rejecting | ✗ Ruled out | "AR backend open" = AR backend accepted |
| Raw TCP race condition | ✗ Fixed | Replaced with `ws` library in server.mjs |
| Camera permission suspension | ✗ Fixed | `enabled: isCameraOnlyMode && isActive` |
| React Strict Mode double-mount | ✗ Fixed | `reactStrictMode: false` |
| perMessageDeflate negotiation | ✗ Applied | `perMessageDeflate: false` on both sides — but 1002 **persists** |
| Invalid close code forwarding | ✗ Fixed | arWs.on("close") sanitizes 1004/1005/1006 → 1000 |
| Infinite reconnect loop | ✗ Fixed | Removed counter reset in onopen + exponential backoff |

### Active Hypotheses for 1002
1. **iOS Safari rejects a specific WS handshake header** that the ws library includes in the 101 response. Safari is more strict than Chrome/Firefox about what the server may include. Candidate: the server including unexpected extension/subprotocol headers.
2. **AR backend sends something immediately** that gets forwarded to the phone, and Safari can't handle it. (Unlikely — AR backend only sends after receiving a frame.)
3. **ngrok modifies WebSocket frames** in a way that corrupts the framing for iOS Safari. (Possible — ngrok runs HTTP/2 internally and transcodes to HTTP/1.1.)
4. **The ws library version** has a known Safari incompatibility at the protocol level beyond perMessageDeflate.

### Diagnostic Next Steps (not yet tried)
1. **Read close reason string** — server.mjs now logs `reason` alongside code. Run another test and check for a reason string beyond "(none)". May reveal the exact protocol rule Safari is enforcing.
2. **Test from laptop browser** — open Chrome DevTools console, run:
   ```js
   const ws = new WebSocket("wss://YOUR-NGROK.ngrok-free.app/ws/camera/test123");
   ws.onopen = () => { ws.send(JSON.stringify({role:"producer"})); console.log("open") };
   ws.onclose = e => console.log("close", e.code, e.reason);
   ```
   If laptop Chrome works but iPhone Safari doesn't → iOS Safari-specific issue.
3. **Test over LAN (bypass ngrok)** — connect iPhone to same WiFi, use `http://192.168.x.x:3000/live`. If LAN works but ngrok doesn't → ngrok is the problem.
4. **Capture the actual 101 response** — log `req.headers` in the upgrade handler to see what Safari sends in the Upgrade request, and inspect the ws library's 101 response headers.

---

## All Fixes Applied

### Fix 1 — `next.config.ts`: Wildcard `allowedDevOrigins`
- Status: ✅ Done
- `"*.ngrok-free.app"` wildcard

### Fix 2 — AR backend startup path confirmed
- Status: ✅ Documented
- Must run from `skillforge/backend/` with venv from `skillforge-api/.venv`

### Fix 3 — `live/page.tsx`: voice commands gated on `isActive`
- Status: ✅ Done
- `enabled: !isCameraOnlyMode && isActive && micEnabled`

### Fix 4 — `server.mjs`: WebSocket proxy v2 (`ws` library)
- Status: ✅ Done
- `WebSocketServer({ noServer: true })` + `new WebSocket(arUrl)` client
- Message buffering: phone frames queued until arWs opens
- Full close/error handling

### Fix 5 — `useCameraRoomViewer`: direct `ws://localhost:8001`
- Status: ✅ Done
- Laptop viewer bypasses proxy and ngrok entirely

### Fix 6 — `live/page.tsx`: QR code hydration mismatch
- Status: ✅ Done
- `useState("")` + `useEffect` instead of `typeof window` IIFE in JSX

### Fix 7 — `live/page.tsx`: producer gated on `isActive`
- Status: ✅ Done
- `enabled: isCameraOnlyMode && isActive`

### Fix 8 — `next.config.ts`: disable React Strict Mode
- Status: ✅ Done
- `reactStrictMode: false`

### Fix 9 — `useCameraRoomProducer.ts`: auto-reconnect on abnormal close
- Status: ✅ Done (exponential backoff, 5 max attempts)

### Fix 10 — `server.mjs`: disable perMessageDeflate
- Status: ✅ Done
- `perMessageDeflate: false` on both WebSocketServer and arWs client
- Prevents iOS Safari 1002 from ws library compression extension negotiation
- **Result: 1002 STILL occurring. perMessageDeflate was not the root cause.**

### Fix 11 — `server.mjs`: sanitize unsendable close codes
- Status: ✅ Done
- arWs.on("close") maps 1004/1005/1006 → 1000 before forwarding to phoneWs
- Prevents RangeError in ws library

### Fix 12 — `useCameraRoomProducer.ts`: fix infinite reconnect loop
- Status: ✅ Done
- Removed `reconnectCountRef.current = 0` from `ws.onopen`
- Added exponential backoff: 2s → 4s → 8s → 16s → 32s

### Fix 13 — `server.mjs`: log close reason string
- Status: ✅ Done
- phoneWs and arWs close handlers now log `reason` string in addition to code
- Needed to diagnose the 1002 root cause in next test

---

## Test Checklist
- [ ] `node server.mjs` starts, logs `WebSocket /ws/* proxied → ws://localhost:8001`
- [ ] AR backend running on port 8001
- [ ] Phone scans QR → grants camera → taps "Start camera"
- [ ] Server logs "Phone connected" AFTER camera starts
- [ ] Server logs "AR backend open. Flushing N buffered frame(s)"
- [ ] Server logs close **with reason string** (not just code)
- [ ] Phone shows "Connected" (not "Disconnected")
- [ ] Laptop QR modal shows "Phone connected"
- [ ] Phone camera feed visible on laptop canvas
- [ ] Hand landmarks render over feed
