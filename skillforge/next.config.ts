import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React Strict Mode to prevent the double-mount in development.
  // Strict Mode runs useEffect cleanup+setup twice, causing useCameraRoomProducer
  // to open a WebSocket, close it (ws.close(1000)), then open a new one. On mobile
  // browsers, the close frame is sent but the TCP connection is dropped before the
  // server can respond → server reports code 1006 → phone shows "Disconnected".
  reactStrictMode: false,
  // Allow dev server to serve when opened via LAN IP or ngrok. Add your ngrok origin if it changes.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "http://192.168.114.254:3000",
    "https://192.168.114.254:3000",
    "192.168.114.254",
    "192.168.114.254:3000",
    "http://192.168.43.1:3000",
    "https://192.168.43.1:3000",
    "192.168.43.1",
    "http://172.21.160.1:3000",
    "https://172.21.160.1:3000",
    "172.21.160.1",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/python/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
      // NOTE: Do NOT add a /ws/:path* rewrite here.
      // server.mjs handles all /ws/* WebSocket upgrades directly at the HTTP server
      // level (before Next.js sees them). Adding a rewrite causes Next.js to ALSO
      // proxy the WebSocket upgrade to localhost:8001 with perMessageDeflate enabled
      // by default, creating two simultaneous connections to the AR backend and
      // leaking RSV1-set (compressed) frames to clients that never negotiated
      // compression → "RSV1 must be clear" / "Invalid frame header" error.
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "8000",
        pathname: "/uploads/**",
      },
    ],
  },
};

export default nextConfig;
