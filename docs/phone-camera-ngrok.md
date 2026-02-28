# Phone as camera (ngrok)

Mobile browsers allow camera access only in a **secure context** (HTTPS). To use your phone as the camera source for the "Use phone as camera" flow on `/live`, expose the Next.js app and the AR WebSocket server over HTTPS using ngrok. Your laptop runs both on plain HTTP/WS; ngrok provides the HTTPS/WSS tunnels the phone needs.

**If ngrok gives you only one hostname** (common on the free plan), use the [Single URL (Next.js rewrites)](#single-url-one-ngrok-hostname) flow below. If you get two different ngrok URLs, use [Two tunnels](#two-ngrok-tunnels) instead.

---

## Prerequisites

- [ngrok](https://ngrok.com/download) installed.
- ngrok authtoken: sign up at [dashboard.ngrok.com](https://dashboard.ngrok.com/signup), then run `ngrok config add-authtoken YOUR_TOKEN`. If you use the project config (`ngrok.yml`) when starting tunnels, you can instead set `NGROK_AUTHTOKEN` in the environment when running ngrok.

---

## Single URL (one ngrok hostname)

Use this when ngrok assigns a single URL for all tunnels. Next.js on port 3000 rewrites `/ws/*` to the AR backend (8001), so one ngrok URL serves both the app and the WebSocket. No Caddy or extra proxy required.

**Start order:**

1. **Terminal 1 — AR backend:**
   ```bash
   cd skillforge/backend
   uv run uvicorn main:app --host 0.0.0.0 --port 8001
   ```

2. **Terminal 2 — Next.js** (port 3000):
   ```bash
   cd skillforge
   pnpm dev
   ```

3. **Terminal 3 — ngrok:**
   ```bash
   ngrok http 127.0.0.1:3000
   ```
   Using `127.0.0.1` instead of `localhost` avoids IPv6 (`::1`) connection refused on Windows when Next.js listens on IPv4 only.

**Environment:** In `skillforge/.env.local` set both to the **same** ngrok hostname (hostname only for `NEXT_PUBLIC_WS_HOST`):

```env
NEXT_PUBLIC_APP_URL=https://your-ngrok-host.ngrok-free.dev
NEXT_PUBLIC_WS_HOST=your-ngrok-host.ngrok-free.dev
```

Restart the Next.js dev server after changing. Then open `NEXT_PUBLIC_APP_URL/live`, click **Use phone as camera**, scan the QR on your phone; the phone loads the app and connects to `wss://<same-host>/ws/camera/...`, which Next.js rewrites to the AR backend.

**If the WebSocket connection fails** (e.g. no frames, connection drops), try the [Two tunnels](#two-ngrok-tunnels) flow instead; some setups may require a dedicated proxy for WebSocket upgrades.

---

## Two ngrok tunnels

Use this when you get **two different** ngrok URLs (e.g. from running `ngrok http 3000` and `ngrok http 8001` in separate terminals).

### 1. Start the app and AR backend (plain HTTP)

**Terminal 1 — Next.js:**

```bash
cd skillforge
pnpm dev
```

**Terminal 2 — AR backend:**

```bash
cd skillforge/backend
uv run uvicorn main:app --host 0.0.0.0 --port 8001
```

---

### 2. Start ngrok tunnels

From the repo root (where `ngrok.yml` lives):

```bash
ngrok start --all --config ngrok.yml
```

If you use a project config and get an auth error, set your token before running:

```bash
# PowerShell
$env:NGROK_AUTHTOKEN = "your-token"
ngrok start --all --config ngrok.yml
```

Note the two **HTTPS** URLs ngrok prints: one for the **app** (port 3000) and one for **ar** (port 8001).

---

### 3. Environment variables

In `skillforge/.env.local`:

```env
NEXT_PUBLIC_APP_URL=https://your-app-tunnel.ngrok-free.app
NEXT_PUBLIC_WS_HOST=your-ar-tunnel.ngrok-free.app
```

- **NEXT_PUBLIC_APP_URL** — Full HTTPS URL of the **app** tunnel (e.g. `https://abc123.ngrok-free.app`).
- **NEXT_PUBLIC_WS_HOST** — Hostname only of the **ar** tunnel (e.g. `def456.ngrok-free.app`). Do not include a port; ngrok uses 443.

Restart the Next.js dev server after changing these so the QR code and WebSocket URLs use the ngrok endpoints.

---

### 4. Flow

1. On your laptop: open `NEXT_PUBLIC_APP_URL/live` (e.g. `https://abc123.ngrok-free.app/live`), click **Use phone as camera**, and show the QR code.
2. On your phone: scan the QR code and open the URL. If ngrok shows an interstitial, tap through to visit the site.
3. On your phone: tap **Start camera** and allow camera (and mic if prompted). The stream connects over WSS via the AR tunnel to your laptop.

---

## Troubleshooting

- **Next.js blocks the request origin:** If the dev server rejects requests from the ngrok app URL, add that origin to `allowedDevOrigins` in `skillforge/next.config.ts` (e.g. `https://your-app-tunnel.ngrok-free.app`). The URL changes each time you restart ngrok unless you use a reserved domain.
- **ERR_NGROK_8012 (connection refused):** If localhost works in the browser but ngrok cannot connect, ngrok may be using IPv6 (`::1`) while Next.js listens on IPv4. Run `ngrok http 127.0.0.1:3000` instead of `ngrok http 3000`.
- **Free tier:** Tunnels get new URLs on each run; update `.env.local` and restart Next.js when the URLs change.
