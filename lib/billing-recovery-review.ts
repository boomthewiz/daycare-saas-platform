export type RecoveryPolicy = { version: number; maxDurationSeconds: number; maxRenewals: number; stepupSeconds: number; requiresSecondApproval: boolean }
export type RecoveryContext = {
 userId: string; organizationId: string; organizationName: string; workforceVersion: number; role: string;
 managed: boolean; version: number; trialEndsAt: string | null; paidThrough: string | null;
 grace: {id: string; expiresAt: string} | null; serverNow: string; policy: RecoveryPolicy | null
}
export type RecoveryReview = {
 id: string; actorId: string; organizationId: string; validUntil: string; serverNow: string; approved: boolean; confirmed: boolean;
 request: {action: "grant" | "revoke"; organization: string; grace: string | null; version: number; policy: number; expires: string | null; ticket: string; reason: string};
 snapshot: RecoveryContext
}
/** UTC entry avoids silently interpreting a nonexistent/repeated device-local hour. */
export function recoveryExpiry(value: string): string {
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter the exact expiry in UTC.")
 const parsed = new Date(value + "Z")
 if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,16) !== value) throw new Error("Enter a valid UTC expiry.")
 return parsed.toISOString()
}
export function recoveryContext(value: unknown, organizationId: string): RecoveryContext | null {
 if (!value || typeof value !== "object") return null
 const v=value as RecoveryContext
 if (v.organizationId!==organizationId || typeof v.userId!=="string" || typeof v.organizationName!=="string" || !Number.isInteger(v.version) || !Number.isInteger(v.workforceVersion) || typeof v.managed!=="boolean" || !Number.isFinite(Date.parse(v.serverNow))) return null
 if (v.policy && (!Number.isInteger(v.policy.version) || typeof v.policy.requiresSecondApproval!=="boolean")) return null
 return v
}
export function recoveryReview(value: unknown, organizationId: string): RecoveryReview | null {
 if(!value || typeof value!=="object")return null
 const v=value as RecoveryReview
 if(typeof v.id!=="string" || typeof v.actorId!=="string" || v.organizationId!==organizationId || !v.request || v.request.organization!==organizationId || !["grant","revoke"].includes(v.request.action) || typeof v.approved!=="boolean" || typeof v.confirmed!=="boolean" || !Number.isFinite(Date.parse(v.validUntil)) || !Number.isFinite(Date.parse(v.serverNow)) || !recoveryContext(v.snapshot,organizationId))return null
 return v
}
