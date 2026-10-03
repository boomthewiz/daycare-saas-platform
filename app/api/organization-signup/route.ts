import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { verifiedIdentity, deviceState, privateHeaders as headers } from "@/lib/device-session-server"

export async function GET() {
  return NextResponse.json({ enabled: process.env.SELF_SERVICE_SIGNUP_ENABLED === "true" }, { headers })
}

export async function POST(request: Request) {
  if (process.env.SELF_SERVICE_SIGNUP_ENABLED !== "true") {
    return NextResponse.json({ error: "Organization signup is not available yet. Please check back later." }, { status: 503, headers })
  }
  try {
    const body = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400, headers })
    }
    if (body.action === "send") {
      if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400, headers })
      }
      const email = body.email.trim().toLowerCase()
      const { data, error } = await supabaseAdmin.rpc("reserve_pin_login_attempt", {
        p_account_key: createHash("sha256").update("email:" + email).digest("hex"),
      })
      if (error || typeof data?.[0]?.allowed !== "boolean") throw new Error("Limiter unavailable")
      if (!data[0].allowed) return NextResponse.json({ error: "Please wait before requesting another code." }, { status: 429, headers })
      const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { error: sendError } = await auth.auth.signInWithOtp({ email, options: {
        shouldCreateUser: true,
      } })
      if (sendError) throw new Error("Email unavailable")
      return NextResponse.json({ success: true }, { headers })
    }
    if (!["create", "status"].includes(body.action)) return NextResponse.json({ error: "Invalid action." }, { status: 400, headers })
    const identity = await verifiedIdentity(request)
    if (!identity) return NextResponse.json({ error: "Verify your email to continue." }, { status: 401, headers })
    const state = await deviceState(identity.user.id, identity.sessionId)
    if (body.action === "status") {
      if (!["unlocked", "setup"].includes(state.state)) {
        return NextResponse.json({ error: "Verify your email to continue." }, { status: 401, headers })
      }
      const { data: profile, error } = await supabaseAdmin.from("users").select("organization_id").eq("id", identity.user.id).single()
      if (error || !profile) throw new Error("Profile unavailable")
      return NextResponse.json({
        email: identity.user.email,
        canCreate: state.canSetPin === true,
        destination: profile.organization_id ? (state.state === "setup" ? "/set-pin" : "/dashboard") : null,
      }, { headers })
    }
    // The form may remain open while another tab changes the signed-in account.
    // Never create an organization for an identity different from the displayed email.
    if (typeof body.email !== "string" || !identity.user.email
      || body.email.trim().toLowerCase() !== identity.user.email.toLowerCase()) {
      return NextResponse.json({ error: "Your signed-in account changed. Verify the email shown here again to continue." }, { status: 401, headers })
    }
    if (!["unlocked", "setup"].includes(state.state) || !state.canSetPin) {
      return NextResponse.json({ error: "Sign in with your email again to create your organization." }, { status: 401, headers })
    }
    const fields = [body.name, body.fullName, body.branchName, body.organizationType]
    if (fields.some(value => typeof value !== "string" || !value.trim() || value.length > 160) || body.organizationType.length > 80) {
      return NextResponse.json({ error: "Complete the required organization fields." }, { status: 400, headers })
    }
    const { data: organizationId, error } = await supabaseAdmin.rpc("create_self_service_organization", {
      p_user_id: identity.user.id, p_session_id: identity.sessionId, p_name: body.name,
      p_full_name: body.fullName, p_branch_name: body.branchName, p_organization_type: body.organizationType,
    })
    if (error?.code === "23505") return NextResponse.json({ error: "This account already has an organization. Sign in to open your workspace." }, { status: 409, headers })
    if (error?.code === "42501") return NextResponse.json({ error: "Verify your email again to create your organization." }, { status: 401, headers })
    if (error || !organizationId) throw new Error("Creation unavailable")
    return NextResponse.json({ organizationId, destination: state.state === "setup" ? "/set-pin" : "/dashboard" }, { headers })
  } catch {
    return NextResponse.json({ error: "Unable to complete setup right now. Your information is still here; please try again." }, { status: 503, headers })
  }
}
