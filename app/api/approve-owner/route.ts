import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

export async function POST(req: Request) {
  try {
    const {
      requestId,
      fullName,
      email,
      daycareName,
    } = await req.json()

    if (!requestId || !fullName || !email || !daycareName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // 1️⃣ Create daycare record
    const { data: daycareData, error: daycareError } =
      await supabaseAdmin
        .from("daycares")
        .insert({
          name: daycareName,
        })
        .select()
        .single()

    if (daycareError) {
      return NextResponse.json(
        { error: daycareError.message },
        { status: 400 }
      )
    }

    const daycareId = daycareData.id

    // 2️⃣ Invite owner via Supabase Auth
    const {
      data: inviteData,
      error: inviteError,
    } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo:
          "https://www.rejoyceapp.com/onboarding-owner",
      }
    )

    if (inviteError) {
      return NextResponse.json(
        { error: inviteError.message },
        { status: 400 }
      )
    }

    const userId = inviteData.user?.id

    // 3️⃣ Insert into public.users
    const { error: userInsertError } =
      await supabaseAdmin
        .from("users")
        .insert({
          id: userId,
          daycare_id: daycareId,
          full_name: fullName,
          role: "owner",
        })

    if (userInsertError) {
      return NextResponse.json(
        { error: userInsertError.message },
        { status: 400 }
      )
    }

    // 4️⃣ Mark request as approved
    const { error: requestUpdateError } =
      await supabaseAdmin
        .from("owner_requests")
        .update({
          status: "approved",
        })
        .eq("id", requestId)

    if (requestUpdateError) {
      return NextResponse.json(
        { error: requestUpdateError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Owner approved successfully",
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