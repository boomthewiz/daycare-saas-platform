import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

export async function POST(req: Request) {
  try {
    const { email, daycareId, fullName } = await req.json()

    // Basic validation
    if (!email || !daycareId || !fullName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // 1️⃣ Invite teacher through Supabase Auth
    const {
      data: inviteData,
      error: inviteError,
    } = await supabaseAdmin.auth.admin.inviteUserByEmail(email)

    if (inviteError) {
      return NextResponse.json(
        { error: inviteError.message },
        { status: 400 }
      )
    }

    const userId = inviteData.user?.id

    if (!userId) {
      return NextResponse.json(
        { error: "User invite succeeded, but no user ID returned" },
        { status: 500 }
      )
    }

    // 2️⃣ Insert teacher profile into public.users
    const { error: insertError } = await supabaseAdmin
      .from("users")
      .insert({
        id: userId,
        daycare_id: daycareId,
        full_name: fullName,
        role: "teacher",
      })

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Teacher invited successfully",
    })
  } catch (error) {
    console.error("Invite teacher error:", error)

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}