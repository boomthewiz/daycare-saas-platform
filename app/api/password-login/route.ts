import { NextResponse } from "next/server"
import { createHash, randomBytes } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { verifiedIdentity, deviceState, privateHeaders as headers } from "@/lib/device-session-server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (typeof body?.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      || typeof body.password !== "string" || body.password.length === 0 || body.password.length > 1024) {
      return NextResponse.json({ error: "Enter your email and password." }, { status: 400, headers })
    }
    const email = body.email.trim().toLowerCase()
    const key = createHash("sha256").update("password-login:" + email).digest("hex")
    const { data: limits, error: limitError } = await supabaseAdmin.rpc("reserve_pin_login_attempt", { p_account_key: key })
    const attempt = limits?.[0]
    if (limitError || typeof attempt?.allowed !== "boolean" || !Number.isInteger(attempt.retry_after)
      || (attempt.allowed && typeof attempt.attempt_id !== "string")) throw new Error("Limiter unavailable")
    if (!attempt.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Please wait and try again." }, {
      status: 429, headers: { ...headers, "Retry-After": String(Math.max(1, attempt.retry_after)) },
    })
    const startedAt = new Date().toISOString()
    // A fresh client prevents one person's sign-in from affecting another request.
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await auth.auth.signInWithPassword({ email, password: body.password })
    if (error?.status === 429) return NextResponse.json({ error: "Too many sign-in attempts. Please wait and try again." }, { status: 429, headers: { ...headers, "Retry-After": "60" } })
    if (error && (error.status === undefined || error.status >= 500) && error.code !== "invalid_credentials") {
      return NextResponse.json({ error: "Password sign-in is temporarily unavailable. Please try again shortly." }, { status: 503, headers })
    }
    if (error || !data.session || !data.user) return NextResponse.json({ error: "Unable to sign in with that email and password." }, { status: 401, headers })
    const identity = await verifiedIdentity(new Request(request.url, { headers: { Authorization: `Bearer ${data.session.access_token}` } }))
    if (!identity || identity.user.id !== data.user.id) throw new Error("Invalid verified session")
    // The legacy email-named proof gate also accepts a fresh, server-verified password login. It never
    // reaches the browser and is consumed atomically by the existing SQL gate.
    const proofHash = createHash("sha256").update(randomBytes(32)).digest("hex")
    const { error: saveError } = await supabaseAdmin.from("email_login_challenges").insert({
      proof_hash: proofHash, user_id: identity.user.id, created_at: startedAt,
    })
    if (saveError) throw saveError
    let status
    try { status = await deviceState(identity.user.id, identity.sessionId, "complete_email", proofHash) }
    finally { await supabaseAdmin.from("email_login_challenges").delete().eq("proof_hash", proofHash) }
    if (status.state !== "unlocked" && status.state !== "setup") return NextResponse.json({ error: "Unable to sign in. Contact your administrator if this continues." }, { status: 401, headers })
    await supabaseAdmin.from("pin_login_attempts").delete().eq("id", attempt.attempt_id).eq("account_key", key)
    const { data: profile, error: profileError } = await supabaseAdmin.from("users").select("organization_id").eq("id", identity.user.id).single()
    if (profileError || !profile) throw new Error("Profile unavailable")
    return NextResponse.json({ state: status.state, hasOrganization: !!profile.organization_id, session: {
      access_token: data.session.access_token, refresh_token: data.session.refresh_token,
    } }, { headers })
  } catch { return NextResponse.json({ error: "Unable to finish signing in. Please try again shortly." }, { status: 503, headers }) }
}
