export type CapabilityKey = "clients" | "users" | "sessions" | "reports" | "reviews" | "billing" | "accessRequests" | "people"
export type EffectiveCapabilities = Record<CapabilityKey, boolean> & {
  userId: string; organizationId: string; canWrite: boolean; owner: boolean
  reportingTimezone: string | null; reportingToday: string | null
}
/** Reject incomplete/legacy payloads; never infer grants from a role or vocabulary. */
export function normalizeCapabilities(value: unknown): EffectiveCapabilities | null {
  if (!value || typeof value !== "object") return null
  const source = value as Record<string, unknown>
  const booleans = ["clients", "users", "sessions", "reports", "reviews", "billing", "accessRequests", "canWrite", "owner"]
  if (booleans.some(key => !Object.hasOwn(source, key) || typeof source[key] !== "boolean") ||
    typeof source.userId !== "string" || typeof source.organizationId !== "string" ||
    !source.userId || !source.organizationId ||
    !(source.reportingTimezone === null || typeof source.reportingTimezone === "string") ||
    !(source.reportingToday === null || typeof source.reportingToday === "string")) return null
  return { ...Object.fromEntries(booleans.map(key => [key, source[key]])), userId: source.userId,
    organizationId: source.organizationId, reportingTimezone: source.reportingTimezone, reportingToday: source.reportingToday,
    people: source.clients === true || source.users === true || source.sessions === true } as EffectiveCapabilities
}
export function reportAvailable(report: string, capabilities: EffectiveCapabilities | null): boolean {
  if (!capabilities?.reports) return false
  if (report === "D1") return capabilities.clients || capabilities.sessions
  if (report === "D2") return capabilities.users
  if (report === "D3") return capabilities.sessions
  return false
}
