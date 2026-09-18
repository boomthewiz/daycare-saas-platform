import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import bcrypt from "bcryptjs"
import { createHash } from "node:crypto"

export const runtime = "nodejs"
const headers = { "Cache-Control": "private, no-store" }

export async function POST(req: Request) {
  try {
    const { username, pin } = await req.json()

    if (typeof username !== "string" || !username.trim() || username.length > 256 || typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return NextResponse.json(
        { error: "Missing credentials" },
        { status: 400 }
      )
    }

    // Reserve before looking up an account or checking its PIN. All Vercel
    // instances share this counter; unknown usernames follow the same path.
    const accountKey = createHash("sha256").update(username.trim().toLowerCase()).digest("hex")
    const { data: reservations, error: limitError } = await supabaseAdmin.rpc(
      "reserve_pin_login_attempt", { p_account_key: accountKey }
    )
    const reservation = reservations?.[0]
    if (limitError || !reservation || typeof reservation.allowed !== "boolean"
      || !Number.isInteger(reservation.retry_after) || reservation.retry_after < 0
      || (reservation.allowed && typeof reservation.attempt_id !== "string")) {
      return NextResponse.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 503, headers })
    }
    if (!reservation.allowed) {
      const seconds = Math.max(1, reservation.retry_after)
      const minutes = Math.ceil(seconds / 60)
      return NextResponse.json({ error: `Too many PIN attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, {
        status: 429, headers: { ...headers, "Retry-After": String(seconds) },
      })
    }

    // Find user using the existing exact username matching behavior.
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, email, pin_hash, status, pin_reset_required")
      .eq("username", username)
      .single()

    if (error || !user || user.status !== "active" || user.pin_reset_required || !user.pin_hash || !user.email) {
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

    // Remove only this successful attempt, never other concurrent failures.
    // If cleanup fails, the reservation safely expires after 24 hours.
    await supabaseAdmin.from("pin_login_attempts").delete().eq("id", reservation.attempt_id).eq("account_key", accountKey)

    return NextResponse.json({
      success: true,
      actionLink: data.properties.action_link,
    }, { headers })
  } catch {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
