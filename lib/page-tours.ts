import type { EffectiveCapabilities } from "./effective-capabilities"
export type TourFamily = "setup" | "people" | "reports"
export type TourStep = { target: string; title: string; text: string }
/** Base tutorial eligibility is separate from vocabulary and business-readiness facts. */
export function tourSteps(family: TourFamily, caps: EffectiveCapabilities | null): TourStep[] {
  if (!caps) return []
  const steps: TourStep[] = []
  if (family === "setup" && (caps.clients || caps.sessions || caps.users)) {
    steps.push({ target: "setup-heading", title: "Set up your everyday workspace", text: "Start with business preferences and the people who use the portal. This optional tour records only your learning on this browser; it never completes business setup for you." })
    if (caps.clients || caps.sessions) steps.push({ target: "setup-preferences", title: "Review business preferences", text: "Open business preferences when you are ready to review branch names and configured activity types. Vocabulary changes display words; it does not grant access or change what records mean." })
    if (caps.clients || caps.sessions) steps.push({ target: "setup-people", title: "Prepare the people roster", text: "Open People to add or review current child profiles and current branch membership. This is a roster, not enrollment history or authorized pickup. Clinical targets and behaviors are not required daycare setup." })
    if (caps.users) steps.push({ target: "setup-roles", title: "Review staff access deliberately", text: "Use Roles and permissions to review supported grants. Active accounts, accepted invitations and completed PIN setup are different facts. This tour never sends an invitation or changes a grant." })
    if (caps.reports) steps.push({ target: "setup-reports", title: "Review operational reports", text: "Reports offers only the sources your permissions allow. A schedule manager must explicitly choose the reporting timezone before schedule reports can run. Attendance and classroom ratios need separate workflows." })
    steps.push({ target: "setup-readiness", title: "Keep business facts separate from learning", text: "The checklist reflects saved organization facts. Finishing this tour changes none of those facts. Mandatory personal PIN setup stays separate from optional learning." })
  }
  if (family === "people" && caps.people) {
    steps.push({ target: "people-heading", title: "Review people for everyday work", text: "People holds current child profiles and staff accounts. Your grants determine which records you can see or change. A clinical assignment and ordinary classroom staffing are separate concepts." })
    steps.push({ target: "people-tabs", title: "Choose the relevant list", text: caps.users ? "Use the child list for current profiles and Team Members for accounts. Switching tabs does not change records. Review staff account readiness separately from child setup." : "Use the child list to review current profiles. A visible name does not grant permission to manage that person or their account." })
    steps.push({ target: "people-search", title: "Find a person", text: "Search by name and use the current branch filter to narrow the list. Current membership is not evidence of historical enrollment or attendance. Entering a form or changing a field pauses this tour." })
    if (caps.clients) steps.push({ target: "people-add", title: "Add a profile when ready", text: caps.canWrite ? "Add a child only when you have the details ready. Save deliberately. Guardians, authorized pickup, attendance events and daily care logs are separate future workflows; program targets are not a daycare prerequisite." : "Your organization currently has read-only access. You can review available records; an administrator must restore editing access before profiles can be saved." })
    if (caps.users) steps.push({ target: "people-tabs", title: "Check staff readiness", text: "In Team Members, distinguish active status, invitation acceptance and account/PIN readiness. An accepted invitation request is not proof of email delivery. Branch assignment is not a shift or proof of staff presence." })
  }
  if (family === "reports" && caps.reports && (caps.clients || caps.users || caps.sessions)) {
    steps.push({ target: "reports-library", title: "Choose an available report", text: "The library shows current roster, staff readiness or schedule activity only when you have the corresponding source authority. Unavailable report families are not unfinished obligations." })
    steps.push({ target: "reports-definition", title: "Read what the report includes", text: "The roster is a current snapshot. Staff readiness is not attendance. Schedule activity is not a child attendance register or payroll. Missing values stay unknown." })
    steps.push({ target: "reports-timezone", title: "Confirm the organization timezone", text: "Schedule dates use the explicit organization reporting timezone, including daylight-saving changes. Snapshot reports do not imply historical enrollment. Only a schedule manager with editing access can save this setting." })
    steps.push({ target: "reports-filters", title: "Choose filters, then run", text: "Select current branch membership, name and status. The schedule report also needs local dates. Run report explicitly. Changing a filter clears displayed results; each page holds at most 100 records." })
    steps.push({ target: "reports-results", title: "Review the returned page", text: "Check the generation time and page number. Empty results mean no matching records, not proof of attendance or completed setup. Selecting Next page makes a fresh authorized query." })
    steps.push({ target: "reports-export", title: "Export only when you intend to", text: "Export this page as CSV makes a fresh authorized query and downloads only the current page. The file includes filter and timezone context. This tour never runs or exports a report for you." })
  }
  return steps
}
export function tourStorageKey(userId: string, organizationId: string, family: TourFamily): string {
  return `rejoyce:learning:v1:${userId}:${organizationId}:${family}`
}
export function parseTourProgress(raw: string | null, stepCount: number): { step: number; status: "paused" | "completed" | "declined" | "new" } {
  try {
    const value = raw ? JSON.parse(raw) : null
    if (value && ["paused", "completed", "declined"].includes(value.status) && Number.isInteger(value.step) && value.step >= 0 && value.step < stepCount) return { step: value.step, status: value.status }
  } catch { /* Corrupt or unsupported learning metadata is ignored. */ }
  return { step: 0, status: "new" }
}
