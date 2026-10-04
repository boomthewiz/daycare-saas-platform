import { createHash } from "node:crypto"

// Durable across server instances; invite and resend share the same recipient key.
type Admin = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }
export function invitationWait(seconds: number, project = false) {
  const retryAfter = Math.max(1, Math.ceil(seconds))
  return {
    error: project
      ? "ReJoyce has reached its email sending limit. Please wait up to 60 minutes before trying again. If this continues, contact support."
      : `An invitation was recently requested for this email. Please wait ${Math.ceil(retryAfter / 60)} minute(s) before trying again. Check the inbox and spam folder first.`,
    code: project ? "EMAIL_SEND_RATE_LIMIT" : "INVITATION_COOLDOWN",
    retryAfter,
  }
}
export function invitationLimit(error: { code?: string; status?: number } | null) {
  return error?.code === "over_email_send_rate_limit" || error?.code === "over_email_send_rate_limit_exceeded"
    ? { seconds: 3600, project: true }
    : error?.status === 429 || error?.code === "over_request_rate_limit"
      ? { seconds: 600, project: false } : null
}
export async function reserveInvitation(admin: Admin, email: string) {
  const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
  const { data, error } = await admin.rpc("reserve_invitation_email", { p_key: key })
  const result = data as { allowed?: boolean; retry_after?: number; project?: boolean } | null
  if (error || !result || typeof result.allowed !== "boolean" ||
      (!result.allowed && (!Number.isFinite(result.retry_after) || Number(result.retry_after) < 1))) {
    return { ok: false as const, status: 503, body: { error: "Unable to safely send an invitation. Please try again later." } }
  }
  if (!result.allowed) return { ok: false as const, status: 429, body: invitationWait(Number(result.retry_after), result.project === true) }
  return { ok: true as const, key }
}
export async function deferInvitation(admin: Admin, key: string, project: boolean) {
  // Keep the original reservation on every outcome, including a network timeout.
  // Do not release it: email delivery can succeed before an ambiguous response.
  try {
    const { error } = await admin.rpc("defer_invitation_email", { p_key: key, p_project: project })
    if (error) console.error("Unable to persist invitation backoff")
  } catch {
    console.error("Unable to persist invitation backoff")
  }
}
