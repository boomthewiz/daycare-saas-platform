import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import bcrypt from "bcryptjs"

export async function POST(req: Request) {
  try {
    const { username, pin } = await req.json()

    if (!username || !pin) {
      return NextResponse.json(
        { error: "Missing credentials" },
        { status: 400 }
      )
    }

    // 1️⃣ Find user
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, email, pin_hash")
      .eq("username", username)
      .single()

    if (error || !user) {
      return NextResponse.json(
        { error: "Invalid login" },
        { status: 401 }
      )
    }

    // 2️⃣ Compare PIN
    const isValid = await bcrypt.compare(pin, user.pin_hash)

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid login" },
        { status: 401 }
      )
    }

    // 3️⃣ Generate magic link for session
    const { data, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: user.email,
      })

    if (linkError || !data?.properties?.action_link) {
      return NextResponse.json(
        { error: "Failed to create session" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      actionLink: data.properties.action_link,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}