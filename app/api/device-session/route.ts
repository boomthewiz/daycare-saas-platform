import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { verifiedIdentity, deviceState, privateHeaders as headers } from "@/lib/device-session-server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function handle(request: Request, action: string, pin?: unknown, proof?: unknown) {
  try {
    const identity = await verifiedIdentity(request)
    if (!identity) return NextResponse.json({ state: "full_login" }, { status: 401, headers })
    const { user, sessionId } = identity
    if (action === "complete_email") {
      if (typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) {
        return NextResponse.json({ state: "full_login", error: "Please request a new email link." }, { status: 401, headers })
      }
      const status = await deviceState(user.id, sessionId, action, createHash("sha256").update(proof).digest("hex"))
      return NextResponse.json(status, { status: status.state === "full_login" ? 401 : 200, headers })
    }
    const status = await deviceState(user.id, sessionId)
    if (status.state === "full_login" || status.state === "inactive") {
      return NextResponse.json(status, { status: 401, headers })
    }
    if (action === "unlock") {
      if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
        return NextResponse.json({ error: "Enter your four-digit PIN." }, { status: 400, headers })
      }
      const key = createHash("sha256").update("pin:" + user.id).digest("hex")
      const { data, error } = await supabaseAdmin.rpc("reserve_pin_login_attempt", { p_account_key: key })
      const reservation = data?.[0]
      if (error || typeof reservation?.allowed !== "boolean" || !Number.isInteger(reservation.retry_after)
        || (reservation.allowed && typeof reservation.attempt_id !== "string")) throw new Error("Limiter unavailable")
      if (!reservation.allowed) {
        const seconds = Math.max(1, reservation.retry_after)
        return NextResponse.json({ error: `Too many PIN attempts. Try again in ${Math.ceil(seconds / 60)} minutes.` }, {
          status: 429, headers: { ...headers, "Retry-After": String(seconds) },
        })
      }
      const { data: profile, error: profileError } = await supabaseAdmin.from("users")
        .select("pin_hash,status,pin_reset_required").eq("id", user.id).single()
      if (profileError || !profile || profile.status !== "active" || profile.pin_reset_required || !profile.pin_hash
        || !await bcrypt.compare(pin, profile.pin_hash)) {
        return NextResponse.json({ error: "Incorrect PIN. Please try again." }, { status: 401, headers })
      }
      // Recheck both long deadlines atomically after bcrypt; unlocking never
      // advances full_auth_at and cannot revive an expired or revoked session.
      const unlocked = await deviceState(user.id, sessionId, "unlock")
      if (unlocked.state === "unlocked") {
        await supabaseAdmin.from("pin_login_attempts").delete().eq("id", reservation.attempt_id).eq("account_key", key)
      }
      return NextResponse.json(unlocked, { headers })
    }
    return NextResponse.json(await deviceState(user.id, sessionId, action), { headers })
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 503, headers })
  }
}

export async function GET(request: Request) { return handle(request, "status") }
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body || !["activity", "lock", "unlock", "logout", "complete_email"].includes(body.action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400, headers })
    }
    return handle(request, body.action, body.pin, body.proof)
  } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400, headers }) }
}
