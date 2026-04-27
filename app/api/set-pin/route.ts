import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import bcrypt from "bcryptjs"

export async function POST(req: Request) {
  try {
    const { username, pin } = await req.json()

    if (!username || !pin) {
      return NextResponse.json(
        { error: "Username and PIN are required" },
        { status: 400 }
      )
    }

    if (pin.length < 4) {
      return NextResponse.json(
        { error: "PIN must be at least 4 digits" },
        { status: 400 }
      )
    }

    // 🔐 Hash PIN
    const pinHash = await bcrypt.hash(pin, 10)

    // 💾 Save to users table
    const { error } = await supabaseAdmin
      .from("users")
      .update({
        pin_hash: pinHash,
      })
      .eq("username", username)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "PIN saved successfully",
    })
  } catch (error: any) {
    console.error(error)

    return NextResponse.json(
      {
        error: "Server error",
      },
      { status: 500 }
    )
  }
}