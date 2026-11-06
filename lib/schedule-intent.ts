export type CalendarFocus = "all" | "classes" | "activities" | "sessions"
export type ServiceModel = "unconfirmed" | "daycare" | "aba" | "mixed"
export type SchedulingKind = "clinical" | "individual" | "group"
type IntentRecord = { workflow_intent?: "clinical" | "activity"; group_activity?: boolean }

export function scheduleKind(record: IntentRecord): SchedulingKind | null {
  if (record.group_activity) return "group"
  if (record.workflow_intent === "clinical") return "clinical"
  if (record.workflow_intent === "activity") return "individual"
  return null
}
export function scheduleLabel(record: IntentRecord): string {
  const kind = scheduleKind(record)
  return kind ? ({ clinical: "ABA session", individual: "Individual Activity", group: "Group Activity" })[kind] : "Scheduled work"
}
export function matchesFocus(record: IntentRecord, focus: CalendarFocus): boolean {
  const kind = scheduleKind(record)
  return focus === "all" || (focus === "classes" ? kind === "group" : focus === "sessions" ? kind === "clinical" : kind === "group" || kind === "individual")
}
export function modelDefaults(model: ServiceModel): { focus: CalendarFocus; kind: SchedulingKind | null; day: boolean } {
  if (model === "daycare") return { focus: "classes", kind: "group", day: true }
  if (model === "aba") return { focus: "sessions", kind: "clinical", day: false }
  return { focus: "all", kind: model === "mixed" ? null : "individual", day: false }
}
