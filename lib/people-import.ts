export type ImportKind = "clients" | "staff"
export const importRoles = ["manager", "director", "therapist", "teacher", "educator", "assistant", "aide", "caregiver", "staff"] as const
export const clientFields = ["external_id", "first_name", "last_name", "preferred_name"] as const
export const staffFields = ["full_name", "email", "role"] as const
export type ImportRow = { row: number; values: Record<string, string>; error: string | null }
export function parseCsv(source: string): string[][] {
  return parseTable(source, ",")
}
// Spreadsheet clipboard selections use tabs. Keep format selection explicit so
// commas in names never change the interpretation of a pasted table.
export function parseTable(source: string, delimiter: "," | "\t"): string[][] {
  if (source.length > 1024 * 1024) throw new Error("Choose a CSV smaller than 1 MB.")
  source = source.replace(/^\uFEFF/, "")
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false
  const pushCell = () => { row.push(cell.trim()); cell = ""; closed = false }
  const pushRow = () => { pushCell(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > 101) throw new Error("Import up to 100 people at a time.") }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } }
      else cell += char
    } else if (char === '"') {
      if (cell || closed) throw new Error("Invalid CSV quoting. Export the file again as CSV.")
      quoted = true
    } else if (char === delimiter) pushCell()
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[i + 1] === "\n") i++; pushRow() }
    else { if (closed) throw new Error("Unexpected text after a quoted CSV value."); cell += char }
  }
  if (quoted) throw new Error("The CSV contains an unfinished quoted value.")
  if (cell || row.length || closed) pushRow()
  if (rows.length < 2) throw new Error("Include a header row and at least one person.")
  if (rows[0].some(value => !value)) throw new Error("Every column needs a heading.")
  if (new Set(rows[0].map(normalizeHeader)).size !== rows[0].length) throw new Error("CSV column headings must be unique.")
  return rows
}
export function normalizeHeader(value: string) { return value.trim().toLowerCase().replace(/\s+/g, "_") }
export function validateImportRows(csv: string[][], kind: ImportKind, mapping: Record<string, number>): ImportRow[] {
  if (csv.length < 2 || !csv[0]?.length) throw new Error("Include a header row and at least one person.")
  if (csv.length > 101) throw new Error("Import up to 100 people at a time.")
  const fields = kind === "clients" ? clientFields : staffFields
  const required = kind === "clients" ? ["external_id", "first_name"] : [...staffFields]
  const mapped = fields.filter(field => mapping[field] >= 0).map(field => mapping[field])
  if (new Set(mapped).size !== mapped.length) throw new Error("Map each CSV column to only one field.")
  if (required.some(field => !Number.isInteger(mapping[field]) || mapping[field] < 0 || mapping[field] >= csv[0].length)) throw new Error("Map all required fields before previewing.")
  if (fields.some(field => mapping[field] !== undefined && mapping[field] !== -1 && (!Number.isInteger(mapping[field]) || mapping[field] < 0 || mapping[field] >= csv[0].length))) throw new Error("Choose an available column for each mapped field.")
  return validatePeopleRows(csv.slice(1).map(cells => Object.fromEntries(fields.map(field => [field, cells[mapping[field]] ?? ""]))), kind,
    csv.slice(1).map(cells => cells.length !== csv[0].length ? "This row has a different number of columns than the header." : null), 2)
}
// Canonical validation is independent of transport. Future adapters must map
// their source fields here before preview; this does not authorize a write.
export function validatePeopleRows(records: Record<string, unknown>[], kind: ImportKind, rowErrors: (string | null)[] = [], firstRow = 1): ImportRow[] {
  if (!records.length) throw new Error("Include at least one person.")
  if (records.length > 100) throw new Error("Import up to 100 people at a time.")
  const fields = kind === "clients" ? clientFields : staffFields
  const required = kind === "clients" ? ["external_id", "first_name"] : [...staffFields]
  const seen = new Set<string>()
  return records.map((record, index) => {
    const values = Object.fromEntries(fields.map(field => [field, typeof record[field] === "string" ? (record[field] as string).trim() : ""]))
    if (kind === "staff") values.email = values.email.toLowerCase()
    const key = kind === "clients" ? values.external_id : values.email
    let error: string | null = null
    if (rowErrors[index]) error = rowErrors[index]
    else if (Object.keys(record).some(field => !fields.some(allowed => allowed === field)) || Object.values(record).some(value => typeof value !== "string")) error = "Use only supported fields with text values."
    else if (required.some(field => !values[field])) error = "Fill every required value."
    else if (Object.values(values).some(value => value.length > 200 || /[\u0000-\u001f]/.test(value))) error = "Values must be at most 200 characters and contain no line breaks."
    else if (kind === "staff" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) error = "Enter a valid email address."
    else if (kind === "staff" && !importRoles.includes(values.role as typeof importRoles[number])) error = "Choose a supported staff role. Owner and admin accounts must be added individually."
    else if (seen.has(key)) error = "Duplicate external ID or email in this file."
    if (key && !error) seen.add(key)
    return { row: index + firstRow, values, error }
  })
}
export function invitationOutcome(status: number, result: unknown): { status: string; done: boolean; pause: boolean } {
  const body = result && typeof result === "object" ? result as Record<string, unknown> : {}
  if (status >= 200 && status < 300 && body.invited === true && typeof body.user_id === "string" && body.user_id) return { status: "Invitation request accepted — delivery unverified", done: true, pause: false }
  if (status === 409 && body.code === "USER_ALREADY_IN_ORGANIZATION") return { status: "Already exists — skipped", done: true, pause: false }
  if (status === 429) {
    const wait = typeof body.retryAfter === "number" && Number.isFinite(body.retryAfter) && body.retryAfter > 0 && body.retryAfter <= 86400
      ? `; wait ${Math.ceil(body.retryAfter / 60)} minute(s)` : ""
    return { status: `Not sent — email limit${wait}; review People before retrying`, done: false, pause: true }
  }
  return { status: "Invitation incomplete or delivery uncertain — review People before retrying", done: false, pause: true }
}
export function csvReport(rows: { row: number; status: string }[]): string {
  const escape = (value: string) => '"' + (/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"'
  return "row,status\r\n" + rows.map(row => `${row.row},${escape(row.status)}`).join("\r\n")
}
