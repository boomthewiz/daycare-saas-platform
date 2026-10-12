// Values verified against production CHECK constraints. Keep stored values intact
// when preparing session targets; labels are presentation only.
export const TARGET_TYPES = [
  { value: "discrete_trial", label: "Discrete trial" },
  { value: "frequency", label: "Frequency" },
  { value: "duration", label: "Duration" },
  { value: "interval", label: "Interval" },
  { value: "task_analysis", label: "Task analysis" },
  { value: "natural_environment", label: "Natural environment" },
  { value: "other", label: "Other" },
]

export const RESPONSE_MODES = [
  { value: "independent_prompted_retry", label: "Independent / prompted / retry" },
  { value: "correct_incorrect", label: "Correct / incorrect" },
  { value: "frequency", label: "Frequency count" },
  { value: "duration", label: "Duration" },
  { value: "custom", label: "Custom" },
]

export const MEASUREMENT_TYPES = [
  { value: "frequency", label: "Frequency", description: "Count each occurrence." },
  { value: "duration", label: "Duration", description: "Track how long the event lasts." },
  { value: "interval", label: "Interval", description: "Track whether the behavior occurs within an observation interval." },
  { value: "intensity", label: "Intensity", description: "Rate the event’s intensity." },
]

export type ReusableBehavior = {
  id: string
  organization_id: string
  client_id: string
  name: string
  description: string | null
  measurement_type: string
  active: boolean
}

export function behaviorKey(behavior: Pick<ReusableBehavior, "name" | "measurement_type">) {
  return JSON.stringify([behavior.name.trim().toLowerCase(), behavior.measurement_type])
}

export function reusableBehaviors(rows: ReusableBehavior[], organizationId: string, clientId: string) {
  const definitions = new Map<string, ReusableBehavior>()
  for (const row of rows) {
    if (row.organization_id !== organizationId || (!row.active && row.client_id !== clientId)) continue
    const key = behaviorKey(row)
    const previous = definitions.get(key)
    // Prefer this client's definition, so applying an inactive definition
    // reactivates it without replacing its individualized guidance.
    if (!previous || row.client_id === clientId) definitions.set(key, row)
  }
  return [...definitions.values()].sort((a, b) => a.name.localeCompare(b.name))
}
