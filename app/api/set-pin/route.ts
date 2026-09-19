import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import bcrypt from "bcryptjs"
import { verifiedIdentity, deviceState } from "@/lib/device-session-server"

export async function POST(req: Request) {
  try {
    const identity = await verifiedIdentity(req)
    if (!identity) return NextResponse.json({ error: "Please sign in with your email." }, { status: 401 })
    const sessionState = await deviceState(identity.user.id, identity.sessionId)
    if (sessionState.state === "full_login" || sessionState.state === "inactive" || !sessionState.canSetPin) {
      return NextResponse.json({ error: "Please sign in with your email again before setting or resetting your PIN." }, { status: 401 })
    }
    const { pin } = await req.json()

    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 400 }
      )
    }

    const authHeader = req.headers.get("authorization")
    const token = authHeader?.match(/^Bearer (\S+)$/i)?.[1]

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Get user from token
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: "Invalid user" },
        { status: 401 }
      )
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("users")
      .select("status")
      .eq("id", user.id)
      .single()

    if (profileError || !profile || profile.status !== "active") {
      return NextResponse.json({ error: "Your account is not active." }, { status: 403 })
    }

    const hash = await bcrypt.hash(pin, 10)

    const { data: saved, error } = await supabaseAdmin
      .from("users")
      .update({ pin_hash: hash, pin_reset_required: false })
      .eq("id", user.id)
      .eq("status", "active")
      .select("id")
      .single()

    if (error || !saved) {
      return NextResponse.json(
        { error: "Unable to save your PIN. Please try again." },
        { status: 500 }
      )
    }

    await deviceState(identity.user.id, identity.sessionId, "unlock")
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
