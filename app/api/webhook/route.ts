import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json({
    error: "Subscription event processing is not configured.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } })
}
