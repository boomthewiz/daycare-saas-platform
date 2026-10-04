export const MIN_SESSION_TYPE_DURATION = 1
export const MAX_SESSION_TYPE_DURATION = 1440

/** Validate syntax before conversion: Number() also accepts exponents and hex. */
export function validateSessionTypeDuration(value: string): string | null {
  if (!value.trim()) return "Enter a default duration in minutes."
  if (/^-\d+(?:\.\d+)?$/.test(value)) return "Default duration must be at least 1 minute."
  if (!/^[0-9]+$/.test(value)) return "Use whole minutes only (digits 0–9), without decimals, signs, or other characters."
  const minutes = Number(value)
  if (minutes < MIN_SESSION_TYPE_DURATION) return "Default duration must be at least 1 minute."
  if (!Number.isSafeInteger(minutes) || minutes > MAX_SESSION_TYPE_DURATION) return "Default duration must be no more than 1,440 minutes (24 hours)."
  return null
}
