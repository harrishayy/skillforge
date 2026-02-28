import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    api_url: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  });
}
