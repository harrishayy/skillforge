/**
 * Custom Next.js server with WebSocket proxy for the AR backend.
 *
 * Uses the `ws` library for proper WebSocket-level proxying instead of raw
 * TCP piping. The raw-TCP approach returned 101 but had a race condition:
 * the phone sends {role:"producer"} immediately after receiving 101, and
 * socket.pipe(target) was only set up inside the async createConnection
 * callback — so that first frame could arrive before the pipe existed,
 * leaving the AR backend without a role message and closing the connection.
 *
 * This implementation:
 *   1. Uses WebSocketServer({ noServer: true }) to do a proper WS handshake
 *      with the phone (no manual header construction).
 *   2. Buffers any messages the phone sends before the AR backend WS opens,
 *      then flushes them on arWs.open — no lost frames.
 *   3. Bridges messages bidirectionally with symmetric close/error handling.
 *   4. Leaves non-/ws/ upgrade events (Next.js HMR) for Next.js to handle.
 *
 * Usage: node server.mjs  (replaces `next dev`)
 */

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3000", 10);

const AR_BACKEND_HOST = "localhost";
const AR_BACKEND_PORT = 8001;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const wss = new WebSocketServer({ noServer: true });

  // Bridge: phone WS  ↔  AR backend WS
  wss.on("connection", (phoneWs, req) => {
    const { pathname } = parse(req.url);
    const arUrl = `ws://${AR_BACKEND_HOST}:${AR_BACKEND_PORT}${pathname}`;
    console.log(`[WS proxy] Phone connected → opening AR backend: ${arUrl}`);

    // Buffer frames that arrive before the AR backend WS is open
    const pendingToAR = [];

    const arWs = new WebSocket(arUrl);

    // Phone → AR backend
    phoneWs.on("message", (data, isBinary) => {
      if (arWs.readyState === WebSocket.OPEN) {
        arWs.send(data, { binary: isBinary });
      } else {
        // Queue until AR backend opens (handles the role-message race)
        pendingToAR.push({ data, isBinary });
        console.log(`[WS proxy] Buffered ${pendingToAR.length} frame(s) until AR backend opens`);
      }
    });

    // AR backend connected — flush any buffered frames
    arWs.on("open", () => {
      console.log(`[WS proxy] AR backend open. Flushing ${pendingToAR.length} buffered frame(s)`);
      const toFlush = pendingToAR.splice(0);
      for (const { data, isBinary } of toFlush) {
        arWs.send(data, { binary: isBinary });
      }
    });

    // AR backend → phone
    arWs.on("message", (data, isBinary) => {
      if (phoneWs.readyState === WebSocket.OPEN) {
        phoneWs.send(data, { binary: isBinary });
      }
    });

    // Close propagation
    phoneWs.on("close", (code, reason) => {
      console.log(`[WS proxy] Phone closed (${code}), terminating AR backend`);
      if (arWs.readyState !== WebSocket.CLOSED) arWs.terminate();
    });

    arWs.on("close", (code, reason) => {
      console.log(`[WS proxy] AR backend closed (${code}), closing phone WS`);
      if (phoneWs.readyState === WebSocket.OPEN) phoneWs.close(code, reason);
    });

    // Error handling
    phoneWs.on("error", (err) => {
      console.error("[WS proxy] Phone WS error:", err.message);
      if (arWs.readyState !== WebSocket.CLOSED) arWs.terminate();
    });

    arWs.on("error", (err) => {
      console.error("[WS proxy] AR backend error:", err.message);
      if (phoneWs.readyState === WebSocket.OPEN) phoneWs.close(1011, "Backend error");
    });
  });

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url);

    if (pathname?.startsWith("/ws/")) {
      // Hand off to our WebSocketServer for proper WS handshake
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      // Non-/ws/ upgrades (Next.js HMR): let Next.js handle via its own
      // upgrade listener registered during app.prepare(). Only destroy if
      // there are no other listeners.
      if (server.listenerCount("upgrade") > 1) return;
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket /ws/* proxied → ws://${AR_BACKEND_HOST}:${AR_BACKEND_PORT}`);
  });
});
