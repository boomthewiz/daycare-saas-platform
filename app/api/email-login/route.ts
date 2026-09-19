import { NextResponse } from "next/server"
import { createHash, randomBytes } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { privateHeaders as headers } from "@/lib/device-session-server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (typeof body?.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400, headers })
    }
    const email = body.email.trim().toLowerCase()
    const { data: limits, error: limitError } = await supabaseAdmin.rpc("reserve_pin_login_attempt", {
      p_account_key: createHash("sha256").update("email:" + email).digest("hex"),
    })
    if (limitError || typeof limits?.[0]?.allowed !== "boolean") throw new Error("Limiter unavailable")
    if (!limits[0].allowed) return NextResponse.json({ error: "Please wait before requesting another link." }, { status: 429, headers })
    const { data: profile } = await supabaseAdmin.from("users").select("id,status").eq("email", email).single()
    // Give the same response for unknown or inactive addresses.
    if (!profile || profile.status !== "active") return NextResponse.json({ success: true }, { headers })
    const proof = randomBytes(32).toString("hex")
    const proofHash = createHash("sha256").update(proof).digest("hex")
    const { error: saveError } = await supabaseAdmin.from("email_login_challenges").insert({ proof_hash: proofHash, user_id: profile.id })
    if (saveError) throw saveError
    const url = new URL(request.url)
    const allowedOrigins = ["https://www.rejoyceapp.com", "https://m.rejoyceapp.com", "https://rejoyceapp.com"]
    if (process.env.NODE_ENV !== "production") allowedOrigins.push("http://localhost:3000")
    const origin = allowedOrigins.includes(url.origin) ? url.origin : "https://www.rejoyceapp.com"
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await auth.auth.signInWithOtp({ email, options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/confirm?proof=${proof}`,
    } })
    if (error) {
      await supabaseAdmin.from("email_login_challenges").delete().eq("proof_hash", proofHash)
      return NextResponse.json({ error: "Unable to send a link right now. Please wait and try again." }, { status: 503, headers })
    }
    // The proof goes only to the email recipient, never to the requesting browser.
    return NextResponse.json({ success: true }, { headers })
  } catch { return NextResponse.json({ error: "Unable to send a link right now. Please try again." }, { status: 503, headers }) }
}

