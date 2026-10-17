export type ReportId = "D1" | "D2" | "D3"
export type ReportRow = Record<string, string | boolean | null>
export type ReportResult = { report: ReportId; asOf: string; timezone: string | null; from: string | null; to: string | null; page: number; hasMore: boolean; rows: ReportRow[] }
export const reportColumns: Record<ReportId, readonly { key: string; label: string }[]> = {
  D1: [{ key: "name", label: "Name" }, { key: "status", label: "Current status" }, { key: "current_branches", label: "Current branches" }],
  D2: [{ key: "name", label: "Name" }, { key: "status", label: "Account status" }, { key: "role", label: "Role" }, { key: "invitation", label: "Invitation acceptance" }, { key: "pin_ready", label: "PIN ready" }, { key: "account_ready", label: "Account ready" }, { key: "branch_assigned", label: "Active branch assigned" }],
  D3: [{ key: "name", label: "Name" }, { key: "activity_type", label: "Activity type" }, { key: "status", label: "Recorded status" }, { key: "scheduled_start", label: "Scheduled start" }, { key: "scheduled_end", label: "Scheduled end" }],
}
export function reportCell(value: string | boolean | null | undefined, key: string, timezone: string | null): string {
  if (value === null || value === undefined) return "Unknown"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (key.startsWith("scheduled_") && timezone) {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(date) : "Unknown"
  }
  return value
}
/** Escape every cell, including whitespace/control-prefixed spreadsheet formulas. */
export function csvCell(value: string): string {
  const protectedValue = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value
  return `"${protectedValue.replace(/"/g, '""')}"`
}
export function reportCsv(result: ReportResult, filters: { branch: string; status: string; search: string }): string {
  const columns = reportColumns[result.report]
  const headings = ["Report", "Generated at (UTC)", "Timezone", "From local date", "Through local date", "Current branch filter", "Status filter", "Name filter", "Page", ...columns.map(column => column.label)]
  const metadata = [result.report, result.asOf, result.timezone ?? "Not configured (snapshot)", result.from ?? "Current snapshot", result.to ?? "Current snapshot", filters.branch || "All current branches", filters.status || "All", filters.search, String(result.page+1)]
  return '\uFEFF' + [headings, ...result.rows.map(row => [...metadata, ...columns.map(column => reportCell(row[column.key], column.key, result.timezone))])].map(row => row.map(csvCell).join(",")).join("\r\n")
}
