import { NextResponse } from "next/server"

// PINs unlock an email-authenticated device; they no longer mint Auth sessions.
export async function POST() {
  return NextResponse.json({ state: "full_login", error: "Sign in with your email first, then use your PIN to unlock this device." },
    { status: 401, headers: { "Cache-Control": "private, no-store" } })
}
