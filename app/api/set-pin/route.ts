import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import bcrypt from "bcryptjs"

export async function POST(req: Request) {
  try {
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

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
