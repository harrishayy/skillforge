# Development over HTTPS (phone camera)

Mobile browsers typically allow camera access only in a **secure context** (HTTPS or localhost). If you open the app on your phone at `http://192.168.x.x:3000`, camera access may be blocked. Use HTTPS for both the Next.js app and the AR backend so the phone can use the "Use phone as camera" flow.

## 1. Next.js dev server over HTTPS

From the frontend app directory (`skillforge/`):

```bash
npm run dev:https
```

This runs `next dev --hostname 0.0.0.0 --experimental-https`, so the app is available at:

- `https://localhost:3000`
- `https://<LAN-IP>:3000` (e.g. `https://192.168.114.254:3000`)

Next.js generates a self-signed certificate automatically. On your phone, open `https://<LAN-IP>:3000` and accept the certificate warning once.

## 2. AR backend over WSS

The camera room WebSocket must be served over **WSS** when the page is loaded over HTTPS. If you run the backend with plain HTTP, the browser will try to connect with `wss://` and you’ll see “Invalid HTTP request received” on the server and no stream on the viewer.

**Phone connections:** the phone connects to `wss://<LAN-IP>:8001`. The certificate must include your LAN IP, or mobile browsers reject the connection (you see the UI but frames never reach the laptop). Create certs that include your LAN IP:

```bash
cd skillforge/backend
mkdir -p certificates
mkcert -key-file certificates/key.pem -cert-file certificates/cert.pem 192.168.114.254 localhost 127.0.0.1
```

Replace `192.168.114.254` with your machine's LAN IP. Then run:

```bash
uv run python run_https.py
```

`run_https.py` prefers `backend/certificates/key.pem` and `cert.pem` when present. Without them it uses Next.js localhost certs—the laptop viewer works but the phone producer will not connect.

## 3. Environment variables

In `skillforge/.env.local`:

```env
NEXT_PUBLIC_APP_URL=https://<LAN-IP>:3000
NEXT_PUBLIC_WS_HOST=<LAN-IP>:8001
```

Replace `<LAN-IP>` with your machine's LAN address (e.g. from `ipconfig` or `ifconfig` on the Wi‑Fi adapter). The QR code and WebSocket URLs will use HTTPS/WSS automatically.

## 4. Flow

1. On your laptop: run `npm run dev:https` in `skillforge/` (this creates SSL certs in `certificates/`). Then run the AR backend with SSL: in `skillforge/backend/` run `uv run python run_https.py`.
2. On your laptop: open `https://<LAN-IP>:3000/live`, click "Use phone as camera", and show the QR code.
3. On your phone: open the camera or a QR scanner, scan the code, and open the URL. Accept the certificate warning if shown.
4. On your phone: tap "Start camera" to allow camera access, then the stream will connect to the laptop.
