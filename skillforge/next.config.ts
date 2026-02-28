import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev server to serve when opened via LAN IP or ngrok. Add your ngrok origin if it changes.
  allowedDevOrigins: [
    "https://phytocidal-unsquabbling-joshua.ngrok-free.dev",
    "phytocidal-unsquabbling-joshua.ngrok-free.dev",
    "https://gaynell-thalloid-layton.ngrok-free.dev",
    "gaynell-thalloid-layton.ngrok-free.dev",
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
      {
        source: "/ws/:path*",
        destination: "http://localhost:8000/ws/:path*",
      },
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
