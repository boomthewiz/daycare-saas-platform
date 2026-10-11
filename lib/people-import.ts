export type ImportKind = "clients" | "staff"
export const importSources = [
  { id: "generic", name: "Other / ReJoyce template", guide: "Map the columns in your file to the required fields." },
  { id: "brightwheel", name: "Brightwheel", guide: "Use Export roster for students or the Staff details report. Include Brightwheel ID (preferred) or a stable Student ID, names, and staff email/role. Export active students; review staff roles." },
  { id: "procare", name: "Procare", guide: "Use Desktop Data Viewer: Child Information/Relationships or Employee Information, exported as CSV. Other Procare products have different reports; review every suggested column and include a stable child ID." },
  { id: "playground", name: "Playground", guide: "Use the Student Data report or staff Download roster CSV. Staff downloads include inactive people even with filters; map a status column or export only the people you intend to invite." },
  { id: "famly", name: "Famly", guide: "Use Reports → Custom lists for children or staff, download CSV, and include names, a stable child ID, and staff email. Select Current people. Personal-data ZIP exports are not roster files." },
  { id: "lillio", name: "Lillio / HiMama", guide: "Use a child/staff profile or custom roster report exported as CSV. Review the available columns and include a stable child ID and staff email. Report headings vary; confirm the mapping before importing." },
] as const
export type ImportSource = typeof importSources[number]["id"]
// Suggestions, not fixed vendor schemas. Customized exports remain manually mappable.
// Never match contact/guardian fields to the child or staff identity.
export function suggestImportMapping(headers: string[], kind: ImportKind, source: ImportSource): Record<string, number> {
  const fields = kind === "clients" ? clientFields : staffFields
  const common: Record<string, string[]> = {
    first_name: ["first_name", "child_first_name", "student_first_name"],
    last_name: ["last_name", "child_last_name", "student_last_name"],
    preferred_name: ["preferred_name", "nickname"],
    full_name: ["full_name", "staff_name", "employee_name", "name"],
    email: ["email", "staff_email", "employee_email", "email_address"],
    role: ["role", "staff_role", "employee_role"],
    external_id: ["external_id"],
  }
  const ids: Record<ImportSource, string[]> = {
    generic: ["external_id"], brightwheel: ["brightwheel_id", "student_id", "external_id"],
    procare: ["child_id", "child_id_number", "external_id"], playground: ["student_id", "child_id", "external_id"],
    famly: ["child_id", "external_id"], lillio: ["child_id", "external_id"],
  }
  const normalized = headers.map(normalizeHeader)
  const used = new Set<number>()
  return Object.fromEntries(fields.map(field => {
    const aliases = source === "generic" ? [field] : field === "external_id" ? ids[source] : common[field]
    const matches = normalized.map((header,index)=>aliases.includes(header) ? index : -1).filter(index=>index >= 0)
    // Only Brightwheel's documented system ID has a safe priority over its custom ID.
    const preferred = source === "brightwheel" && field === "external_id" && normalized.includes("brightwheel_id") ? normalized.indexOf("brightwheel_id") : -1
    const index = preferred >= 0 ? preferred : matches.length === 1 ? matches[0] : -1
    if (index >= 0 && !used.has(index)) { used.add(index); return [field,index] }
    return [field,-1]
  }))
}
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
export function validateImportRows(csv: string[][], kind: ImportKind, mapping: Record<string, number>, options: { roleMapping?: Record<string, string>; statusColumn?: number; staffNameColumns?: [number, number]; idPrefix?: string } = {}): ImportRow[] {
  if (csv.length < 2 || !csv[0]?.length) throw new Error("Include a header row and at least one person.")
  if (csv.length > 101) throw new Error("Import up to 100 people at a time.")
  if (options.idPrefix && !/^[a-zA-Z0-9._-]{1,40}$/.test(options.idPrefix)) throw new Error("ID namespace must contain 1–40 letters, numbers, dots, underscores or hyphens.")
  const fields = kind === "clients" ? clientFields : staffFields
  const required = kind === "clients" ? ["external_id", "first_name"] : options.staffNameColumns ? ["email", "role"] : [...staffFields]
  const mapped = fields.filter(field => mapping[field] >= 0).map(field => mapping[field])
  if (new Set(mapped).size !== mapped.length) throw new Error("Map each CSV column to only one field.")
  if (required.some(field => !Number.isInteger(mapping[field]) || mapping[field] < 0 || mapping[field] >= csv[0].length)) throw new Error("Map all required fields before previewing.")
  if (fields.some(field => mapping[field] !== undefined && mapping[field] !== -1 && (!Number.isInteger(mapping[field]) || mapping[field] < 0 || mapping[field] >= csv[0].length))) throw new Error("Choose an available column for each mapped field.")
  const extras = [...(options.staffNameColumns || []), ...(options.statusColumn !== undefined && options.statusColumn >= 0 ? [options.statusColumn] : [])]
  if (extras.some(index=>!Number.isInteger(index) || index < 0 || index >= csv[0].length) || new Set([...mapped,...extras]).size !== mapped.length + extras.length) throw new Error("Choose distinct available columns for names and source status.")
  const records = csv.slice(1).map(cells => {
    const values = Object.fromEntries(fields.map(field => [field, cells[mapping[field]] ?? ""]))
    if (kind === "clients" && options.idPrefix && values.external_id) values.external_id = `${options.idPrefix}:${values.external_id}`
    if (kind === "staff" && options.staffNameColumns) values.full_name = options.staffNameColumns.map(index=>cells[index]?.trim() || "").join(" ").trim()
    if (kind === "staff" && options.roleMapping) values.role = Object.hasOwn(options.roleMapping,values.role) ? options.roleMapping[values.role] : ""
    return values
  })
  return validatePeopleRows(records, kind, csv.slice(1).map(cells => {
    if (cells.length !== csv[0].length) return "This row has a different number of columns than the header."
    if (options.statusColumn !== undefined && options.statusColumn >= 0 && !["active", "current", "enrolled"].includes(cells[options.statusColumn]?.trim().toLowerCase())) return "Source status is not active/current/enrolled — excluded."
    return null
  }), 2)
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
