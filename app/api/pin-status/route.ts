import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get("authorization")
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1]

    if (!token) {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers })
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers })
    }

    // The identity comes only from the verified token, never a query parameter.
    const { data: profile, error } = await supabaseAdmin
      .from("users")
      .select("pin_hash, pin_reset_required, status")
      .eq("id", user.id)
      .single()

    if (error || !profile) {
      return NextResponse.json({ error: "Unable to check your account. Please try again." }, { status: 503, headers })
    }
    if (profile.status !== "active") {
      return NextResponse.json({ error: "Your account is not active. Contact your administrator." }, { status: 403, headers })
    }

    // Explicitly project safe booleans. Never serialize the database profile.
    return NextResponse.json({
      hasPin: Boolean(profile.pin_hash),
      resetRequired: profile.pin_reset_required === true,
    }, { headers })
  } catch {
    return NextResponse.json({ error: "Unable to check your account. Please try again." }, { status: 503, headers })
  }
}
