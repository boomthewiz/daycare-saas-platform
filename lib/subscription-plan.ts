/** Versioned launch terms. Persist the chosen version and trial end at signup. */
export const launchPlan = Object.freeze({
  version: "launch-2026-09",
  currency: "USD",
  interval: "month",
  trialDays: 30,
  baseAmountCents: 7900,
  includedProviders: 1,
  additionalProviderAmountCents: 2900,
  cardRequiredForTrial: false,
} as const)

/** A display quote only; checkout must obtain its seat count on the server. */
export function monthlyQuoteCents(providerSeats: number): number {
  if (!Number.isSafeInteger(providerSeats) || providerSeats < 0) {
    throw new RangeError("Provider seats must be a nonnegative whole number.")
  }
  const amount = launchPlan.baseAmountCents
    + Math.max(0, providerSeats - launchPlan.includedProviders) * launchPlan.additionalProviderAmountCents
  if (!Number.isSafeInteger(amount)) throw new RangeError("Provider seat count is too large.")
  return amount
}

export function trialEndForCreation(createdAt: string, trialDays: number = launchPlan.trialDays): string {
  const start = Date.parse(createdAt)
  if (!Number.isFinite(start) || !Number.isSafeInteger(trialDays) || trialDays < 1) {
    throw new RangeError("A valid creation time and positive whole trial duration are required.")
  }
  const end = new Date(start + trialDays * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(end.getTime())) throw new RangeError("Trial end is outside the supported date range.")
  return end.toISOString()
}

/** Presentation state only. Database writes need the same check on the server. */
export function organizationAccess(
  entitlement: { trialEndsAt: string | null; paidThrough: string | null },
  serverNow: string,
): "write" | "read_only" | "unavailable" {
  const now = Date.parse(serverNow)
  if (!Number.isFinite(now)) return "unavailable"
  const deadlines = [entitlement.trialEndsAt, entitlement.paidThrough]
  if (deadlines.some(value => value !== null && !Number.isFinite(Date.parse(value)))) return "unavailable"
  return deadlines.some(value => value !== null && Date.parse(value) > now) ? "write" : "read_only"
}
