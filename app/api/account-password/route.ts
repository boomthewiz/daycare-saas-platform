import { NextResponse } from "next/server"
import { deviceState, verifiedIdentity, privateHeaders as headers } from "@/lib/device-session-server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const identity = await verifiedIdentity(request)
    if (!identity) return NextResponse.json({ error: "Sign in again before setting your password." }, { status: 401, headers })
    const state = await deviceState(identity.user.id, identity.sessionId)
    if (state.state !== "unlocked" || !state.canSetPin) {
      return NextResponse.json({ error: "Sign in with an email code or password within the last 10 minutes, then return to Profile." }, { status: 401, headers })
    }
    const { password } = await request.json()
    if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      return NextResponse.json({ error: "Choose at least 12 characters. If your password is very long, try a shorter one." }, { status: 400, headers })
    }
    // Use the user's bearer token, never an administrator password override.
    // auth.updateUser requires a locally stored session; the server only receives
    // a verified access token, so call the same Auth REST endpoint directly.
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL!}/auth/v1/user`, {
      method: "PUT", headers: { Authorization: `Bearer ${identity.token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ password }), cache: "no-store", signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return NextResponse.json({ error: "Unable to save your password. Check the password requirements or sign in again and retry." }, { status: 400, headers })
    return NextResponse.json({ success: true }, { headers })
  } catch {
    return NextResponse.json({ error: "Unable to save your password right now. Please try again." }, { status: 503, headers })
  }
}
