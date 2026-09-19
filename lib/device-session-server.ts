import { supabaseAdmin } from "@/lib/supabase-admin"

export type DeviceState = {
  state: "full_login" | "inactive" | "setup" | "locked" | "unlocked"
  serverNow?: string
  unlockedUntil?: string
  fullAuthUntil?: string
  pinRequiredBy?: string
  canSetPin?: boolean
}

export async function verifiedIdentity(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1]
  if (!token) return null
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user || user.is_anonymous) return null
  try {
    // Decode only after Auth has verified the exact bearer token.
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    if (claims.sub !== user.id || !/^[a-f0-9-]{36}$/i.test(claims.session_id || "")) return null
    return { user, sessionId: claims.session_id as string, token }
  } catch { return null }
}

export async function deviceState(userId: string, sessionId: string, action = "status", proofHash: string | null = null): Promise<DeviceState> {
  const { data, error } = await supabaseAdmin.rpc("manage_device_session", {
    p_user_id: userId, p_session_id: sessionId, p_action: action, p_proof_hash: proofHash,
  })
  if (error || !data || !["full_login", "inactive", "setup", "locked", "unlocked"].includes(data.state)) {
    throw new Error("Unable to check your session. Please try again.")
  }
  return data as DeviceState
}

export const privateHeaders = { "Cache-Control": "private, no-store" }

export async function requireUnlocked(request: Request) {
  const identity = await verifiedIdentity(request)
  if (!identity) return null
  const status = await deviceState(identity.user.id, identity.sessionId)
  return status.state === "unlocked" ? identity : null
}

