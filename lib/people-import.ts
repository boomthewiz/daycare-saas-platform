export type ImportKind = "clients" | "staff"
export const importRoles = ["manager", "director", "therapist", "teacher", "educator", "assistant", "aide", "caregiver", "staff"] as const
export const clientFields = ["external_id", "first_name", "last_name", "preferred_name"] as const
export const staffFields = ["full_name", "email", "role"] as const
export type ImportRow = { row: number; values: Record<string, string>; error: string | null }
export function parseCsv(source: string): string[][] {
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
    } else if (char === ",") pushCell()
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[i + 1] === "\n") i++; pushRow() }
    else { if (closed) throw new Error("Unexpected text after a quoted CSV value."); cell += char }
  }
  if (quoted) throw new Error("The CSV contains an unfinished quoted value.")
  if (cell || row.length || closed) pushRow()
  if (rows.length < 2) throw new Error("Include a header row and at least one person.")
  if (new Set(rows[0].map(value => value.toLowerCase())).size !== rows[0].length) throw new Error("CSV column headings must be unique.")
  return rows
}
export function validateImportRows(csv: string[][], kind: ImportKind, mapping: Record<string, number>): ImportRow[] {
  const fields = kind === "clients" ? clientFields : staffFields
  const required = kind === "clients" ? ["external_id", "first_name"] : [...staffFields]
  const mapped = fields.filter(field => mapping[field] >= 0).map(field => mapping[field])
  if (new Set(mapped).size !== mapped.length) throw new Error("Map each CSV column to only one field.")
  if (required.some(field => !Number.isInteger(mapping[field]) || mapping[field] < 0 || mapping[field] >= csv[0].length)) throw new Error("Map all required fields before previewing.")
  const seen = new Set<string>()
  return csv.slice(1).map((cells, index) => {
    const values = Object.fromEntries(fields.map(field => [field, cells[mapping[field]]?.trim() || ""]))
    if (kind === "staff") values.email = values.email.toLowerCase()
    const key = kind === "clients" ? values.external_id : values.email
    let error: string | null = null
    if (cells.length !== csv[0].length) error = "This row has a different number of columns than the header."
    else if (required.some(field => !values[field])) error = "Fill every required value."
    else if (Object.values(values).some(value => value.length > 200 || /[\u0000-\u001f]/.test(value))) error = "Values must be at most 200 characters and contain no line breaks."
    else if (kind === "staff" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) error = "Enter a valid email address."
    else if (kind === "staff" && !importRoles.includes(values.role as typeof importRoles[number])) error = "Choose a supported staff role. Owner and admin accounts must be added individually."
    else if (seen.has(key)) error = "Duplicate external ID or email in this file."
    if (key) seen.add(key)
    return { row: index + 2, values, error }
  })
}
export function csvReport(rows: { row: number; status: string }[]): string {
  const escape = (value: string) => '"' + (/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"'
  return "row,status\r\n" + rows.map(row => `${row.row},${escape(row.status)}`).join("\r\n")
}
