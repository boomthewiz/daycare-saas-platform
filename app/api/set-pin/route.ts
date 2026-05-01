import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import bcrypt from "bcryptjs"

export async function POST(req: Request) {
  try {
    const { pin } = await req.json()

    if (!pin || pin.length !== 4) {
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 400 }
      )
    }

    const authHeader = req.headers.get("authorization")
    const token = authHeader?.replace("Bearer ", "")

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Get user from token
    const {
      data: { user },
    } = await supabaseAdmin.auth.getUser(token)

    if (!user) {
      return NextResponse.json(
        { error: "Invalid user" },
        { status: 401 }
      )
    }

    const hash = await bcrypt.hash(pin, 10)

    const { error } = await supabaseAdmin
      .from("users")
      .update({ pin_hash: hash })
      .eq("id", user.id)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}