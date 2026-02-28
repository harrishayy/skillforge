import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev server to serve when opened via LAN IP (e.g. phone loading from laptop's IP)
  // Next may match origin by host; include both full origin and bare host for compatibility.
  allowedDevOrigins: [
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
