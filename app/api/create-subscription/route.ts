import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json({
    error: "Subscription checkout is temporarily unavailable. Please try again later.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } })
}
