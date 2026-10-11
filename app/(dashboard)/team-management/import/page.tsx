"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useSetupAccess } from "@/lib/use-setup-access"
import { useBranches } from "@/components/BranchProvider"
import { usePortal } from "@/components/PortalProvider"
import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"
import { clientFields, staffFields, importRoles, parseTable, normalizeHeader, importSources, suggestImportMapping, validateImportRows, invitationOutcome, csvReport, type ImportSource, type ImportKind, type ImportRow } from "@/lib/people-import"

type PreviewRow = ImportRow & { status: string; done?: boolean }
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a"); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function PeopleImportPage() {
  const access = useSetupAccess(), branches = useBranches(), { terms, t } = usePortal()
  const [method, setMethod] = useState("file")
  const [pasted, setPasted] = useState(""), [delimiter, setDelimiter] = useState<"," | "\t">("\t")
  const [kind, setKind] = useState<ImportKind>("clients")
  const [source, setSource] = useState<ImportSource>("generic")
  const [idPrefix, setIdPrefix] = useState("")
  const [roleMapping, setRoleMapping] = useState<Record<string, string>>({})
  const [sourceStatus, setSourceStatus] = useState(-1), [activeReviewed, setActiveReviewed] = useState(false)
  const [combineName, setCombineName] = useState(false), [nameColumns, setNameColumns] = useState<[number, number]>([-1,-1])
  const [csv, setCsv] = useState<string[][]>([]), [mapping, setMapping] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<PreviewRow[]>([]), [branch, setBranch] = useState("")
  const previewOrganization = useRef<string | null>(null)
  const [error, setError] = useState(""), [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false), [fileName, setFileName] = useState("")
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [busy])
  const fields = kind === "clients" ? clientFields : staffFields
  const allowed = !access.loading && !access.error && (kind === "clients" ? access.clients : access.users)
  const ready = preview.filter(row => !row.error && !row.done && row.status === "Ready")
  function reset(next: ImportKind) { setKind(next); setCsv([]); setPreview([]); setFileName(""); setError(""); setMessage(""); setMapping({}); setPasted(""); setRoleMapping({}); setSourceStatus(-1); setActiveReviewed(false); setCombineName(false); setNameColumns([-1,-1]) }
  function mapSource(headers: string[], next: ImportSource) {
    setMapping(suggestImportMapping(headers,kind,next)); setPreview([]); setRoleMapping({}); setActiveReviewed(false); setCombineName(false); setNameColumns([-1,-1])
    const statuses = headers.map((header,index)=>["status","enrollment_status"].includes(normalizeHeader(header)) ? index : -1).filter(index=>index >= 0)
    setSourceStatus(next !== "generic" && statuses.length === 1 ? statuses[0] : -1)
  }
  function loadTable(contents: string, separator: "," | "\t", name: string) {
    const rows = parseTable(contents, separator)
    mapSource(rows[0],source)
    setCsv(rows); setFileName(name)
  }
  function readPaste() {
    setError(""); setMessage(""); setCsv([]); setPreview([]); setFileName("")
    try { loadTable(pasted, delimiter, "Pasted spreadsheet") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to read this table.") }
  }
  async function read(file: File | undefined) {
    setError(""); setMessage(""); setCsv([]); setPreview([]); setFileName("")
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 1024 * 1024) throw new Error("Choose a CSV smaller than 1 MB.")
      if (!/\.(csv|tsv)$/i.test(file.name)) throw new Error("Export your workbook as CSV or TSV, or paste spreadsheet cells below.")
      loadTable(await file.text(), /\.tsv$/i.test(file.name) ? "\t" : ",", file.name)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to read this CSV.") }
    finally { setBusy(false) }
  }
  async function inspect() {
    previewOrganization.current = null
    setError(""); setMessage(""); setPreview([]); setBusy(true)
    try {
      if (!allowed) throw new Error("You do not have permission to import these people.")
      if (source !== "generic" && sourceStatus < 0 && !activeReviewed) throw new Error("Confirm that this roster contains only the people you intend to import or invite, or map a source status column.")
      if (kind === "clients" && (!branch || branches.loading || branches.error || !branches.branches.some(item => item.id === branch && item.active))) throw new Error(t("Choose an active branch for these clients. Create a branch in Setup if needed."))
      const rows = validateImportRows(csv, kind, mapping, { roleMapping: source !== "generic" && kind === "staff" ? roleMapping : undefined, statusColumn: sourceStatus, staffNameColumns: kind === "staff" && combineName ? nameColumns : undefined, idPrefix: kind === "clients" ? idPrefix : undefined })
      const org = await supabase.rpc("current_organization_id")
      if (org.error || !org.data) throw new Error("Unlock your session and try again.")
      const keys = rows.filter(row => !row.error).map(row => kind === "clients" ? row.values.external_id : row.values.email)
      const existing = keys.length ? await supabase.from(kind === "clients" ? "clients" : "users").select(kind === "clients" ? "import_external_id" : "email").eq("organization_id", org.data).in(kind === "clients" ? "import_external_id" : "email", keys) : { data: [], error: null }
      if (existing.error) throw new Error(existing.error.message)
      previewOrganization.current = org.data
      const found = new Set((existing.data as unknown as Record<string, string>[] || []).map(item => kind === "clients" ? item.import_external_id : item.email?.toLowerCase()))
      setPreview(rows.map(row => ({ ...row, status: row.error || (found.has(kind === "clients" ? row.values.external_id : row.values.email) ? "Already exists — skipped" : "Ready"), done: !row.error && found.has(kind === "clients" ? row.values.external_id : row.values.email) })))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to preview the import.") }
    finally { setBusy(false) }
  }
  function update(rowNumber: number, status: string, done = false) { setPreview(current => current.map(row => row.row === rowNumber ? { ...row, status, done } : row)) }
  async function commit() {
    if (!allowed || !ready.length) return
    setBusy(true); setError(""); setMessage("")
    try {
      const organization = await supabase.rpc("current_organization_id")
      if (organization.error || !previewOrganization.current || organization.data !== previewOrganization.current) throw new Error("Your business context changed or could not be verified. Preview the import again before confirming.")
      if (kind === "clients") {
        const result = await supabase.rpc("import_clients", { p_rows: ready.map(row => row.values), p_location_id: branch })
        if (result.error) throw new Error(result.error.message)
        for (const item of result.data as { external_id: string; status: string }[]) {
          const row = ready.find(row => row.values.external_id === item.external_id)
          if (row) update(row.row, item.status === "created" ? "Created" : "Already exists — skipped", true)
        }
        setMessage(t("Client import completed. Add care-team assignments in People when ready."))
      } else {
        let accepted = 0
        for (const row of ready) {
          if (!mounted.current) break
          update(row.row, "Sending…")
          // Fetch a current token for each invitation; the existing endpoint checks device,
          // subscription, role delegation, conflicts and durable email limits again.
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) { update(row.row, "Not sent — sign in before continuing"); throw new Error("Your login expired. Sign in before continuing.") }
          let response: Response
          try { response = await fetch("/api/invite-user", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fullName: row.values.full_name, email: row.values.email, role: row.values.role, organizationId: previewOrganization.current }) }) }
          catch { update(row.row, "Delivery uncertain — check People and the inbox before resending"); throw new Error("Connection interrupted. Invitations paused; review the row report before continuing.") }
          let result: unknown
          try { result = await response.json() }
          catch { update(row.row, "Delivery uncertain — check People and the inbox before resending"); throw new Error("The invitation response was interrupted. Review People before retrying.") }
          const outcome = invitationOutcome(response.status, result)
          update(row.row, outcome.status, outcome.done)
          if (outcome.pause) throw new Error("Invitations paused. Review People and the row report before retrying this person; remaining ready rows can be continued. Email delivery is unverified.")
          if (response.ok) accepted++
        }
        setMessage(`${accepted} invitation request(s) accepted. Delivery is unverified. Existing accounts were skipped.`)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to finish the import. Review the row report.") }
    finally { setBusy(false) }
  }
  const template = kind === "clients" ? "external_id,first_name,last_name,preferred_name\r\nC-001,Sam,Example,Sam" : "full_name,email,role\r\nAlex Example,alex@example.invalid,teacher"
  return <div className="mx-auto max-w-5xl space-y-5">
    <Link href="/team-management" className="underline">Back to People</Link><h1 className="rj-heading-1">Import people</h1>
    <p>Choose CSV/spreadsheet, API, or SFTP. File imports support up to 100 people per batch with column mapping and a preview.</p>
    <fieldset disabled={busy} className="rj-card space-y-3 p-5"><legend className="font-semibold">Import method</legend>
      <label className="block">Method<select className="rj-input mt-1 w-full" value={method} onChange={event => { setMethod(event.target.value); reset(kind) }}><option value="file">CSV / spreadsheet</option><option value="api">API — not configured</option><option value="sftp">SFTP — not configured</option></select></label>
    </fieldset>
    {method !== "file" && <section className="rj-card space-y-3 p-5"><h2 className="rj-heading-3">{method.toUpperCase()} requirements</h2>
      <p>No connection is configured. First choose the source system and confirm its supported export or integration access.</p>
      <ul className="list-disc pl-5 space-y-2"><li>Source system, account/site scope, and permission to read its data.</li><li>Sample data, format, stable IDs, field/role mapping, and branch mapping.</li><li>Import direction, create/update rules, frequency, and failure recovery.</li><li>{method === "api" ? "Official API documentation, authentication type, token scopes/expiry, pagination, and rate limits." : "Who hosts the SFTP server, hostname/port, folder and file naming, encoding/delimiter, delivery schedule, authentication type, and SSH host-key fingerprint."}</li></ul>
      <p>{t("All methods must validate and preview records before confirmation. Staff records, login accounts, invitation requests, and session readiness are separate steps.")}</p>
      <p>Use the CSV / spreadsheet method for an exported roster now. Connection credentials will require secure server-side storage once a connector is selected; do not paste credentials here.</p>
    </section>}
    {method === "file" && <>
    {(error || access.error || branches.error) && <p role="alert" className="rounded-xl bg-red-50 p-3">{error || access.error || branches.error}</p>}
    {message && <section className="rounded-xl bg-green-50 p-3 space-y-2"><p role="status">{message}</p><p>Next, <Link href="/team-management" className="underline">review your people</Link> and <Link href="/setup/care-teams" className="underline">set up staff branches and care assignments</Link>. When setup is ready, <Link href="/sessions" className="underline">create a session</Link>.</p></section>}
    <fieldset disabled={busy} className="rj-card space-y-4 p-5">
      <legend className="font-semibold">1. Choose a list</legend>
      <label className="block">People to import<select className="rj-input mt-1 w-full" value={kind} onChange={event => reset(event.target.value as ImportKind)}><option value="clients">{terms.client_plural}</option><option value="staff">{terms.frontline_plural}</option></select></label>
      <label className="block">Exported from<select className="rj-input mt-1 w-full" value={source} onChange={event => { const next = event.target.value as ImportSource; setSource(next); mapSource(csv[0] || [],next); setError(""); setMessage("") }}>{importSources.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className="text-sm">{importSources.find(item=>item.id===source)?.guide}</p>
      {source !== "generic" && <p className="text-sm">Keep the original CSV headings and column order. Suggested mappings must be reviewed; extra columns are ignored. Missing IDs or email cannot be inferred. Files may contain up to 100 people and 1 MB.</p>}
      {!allowed && !access.loading && <p>Management permission is required for this list.</p>}
      <button className="rj-button rj-button-secondary" onClick={() => download(`rejoyce-${kind}-template.csv`, template)}>Download CSV template</button>
      {kind === "clients" ? <><p className="text-sm">{t("Use a stable, unique external ID from your existing system for each person. If you do not have IDs yet, assign one per person in your spreadsheet (for example C-001, C-002) and keep those IDs for future uploads. Repeat uploads skip matching IDs without overwriting records. People created manually should be reviewed before importing.")} Use distinct source prefixes when combining systems (for example brightwheel:C-001); keep the exact same ID on every upload. Preserve leading zeros by formatting ID columns as text.</p><label className="block">Branch for this list<select className="rj-input mt-1 w-full" value={branch} onChange={event => { setBranch(event.target.value); setPreview([]) }}><option value="">Choose an active branch</option>{branches.branches.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Link className="underline" href="/setup/preferences">Manage branches in Setup</Link></> : <><p className="text-sm">Supported roles: {importRoles.join(", ")}. Review roles before sending. Invitations use the same permissions and email limits as individual invitations. Owner and admin accounts are added individually.</p><p className="text-sm">{t("Loading and previewing staff rows creates no records or accounts and sends no email. Confirming requests account invitations; record-only staff import is not available yet. An invitation request does not mean delivery, acceptance, or readiness for sessions. Review confirmed email, PIN setup, account status, branches, and care assignments in People.")}</p></>}
      <p className="text-sm">Export Excel/Google Sheets as CSV or TSV, or paste selected cells with a header row below. Workbook files (.xlsx/.xls) must be exported first. Only mapped columns are used; extra source fields are ignored.</p>
      <label className="block">CSV or TSV file<input key={`${kind}-${method}`} className="mt-2 block w-full" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={!allowed} onChange={event => void read(event.target.files?.[0])} /></label>
      <label className="block">Paste spreadsheet cells<textarea className="rj-input mt-1 w-full" rows={5} value={pasted} disabled={!allowed} onChange={event => { setPasted(event.target.value); setCsv([]); setPreview([]); setFileName(""); setMessage("") }} /></label>
      <label className="block">Pasted format<select className="rj-input mt-1 w-full" value={delimiter} onChange={event => { setDelimiter(event.target.value as "," | "\t"); setCsv([]); setPreview([]); setFileName("") }}><option value={"\t"}>Spreadsheet cells (tabs)</option><option value=",">CSV text (commas)</option></select></label>
      <button className="rj-button rj-button-secondary" disabled={!allowed || !pasted.trim()} onClick={readPaste}>Load pasted rows</button>
      {fileName && <p className="text-sm">{fileName}: {csv.length - 1} rows loaded.</p>}
    </fieldset>
    {csv.length > 0 && <fieldset disabled={busy} className="rj-card space-y-4 p-5"><legend className="font-semibold">2. Match columns</legend>
      {fields.filter(field=>!(field === "full_name" && combineName)).map(field => <label className="block" key={field}>{field.replaceAll("_", " ")}{["external_id", "first_name", "full_name", "email", "role"].includes(field) ? " (required)" : " (optional)"}<select className="rj-input mt-1 w-full" value={mapping[field] ?? -1} onChange={event => { setMapping(current => ({ ...current, [field]: Number(event.target.value) })); setPreview([]); if(field === "role") setRoleMapping({}) }}><option value={-1}>Not mapped</option>{csv[0].map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label>)}
      {kind === "clients" && <p className="text-sm">If the export contains only one name column, you may map its entire value to first name and leave last name unmapped. ReJoyce preserves that value without guessing where to split it. Keep the same ID column and source prefix on later imports.</p>}
      {kind === "clients" && <label className="block">ID namespace (optional)<input className="rj-input mt-1 w-full" value={idPrefix} maxLength={40} onChange={event=>{setIdPrefix(event.target.value);setPreview([])}} /><span className="block text-sm mt-1">For a new source/site, choose a stable prefix such as brightwheel.site1 to keep IDs distinct. Leave blank for existing imports that used raw IDs. Preview shows the final ID; changing its column or prefix can create duplicates.</span></label>}
      {kind === "staff" && <><label className="flex gap-2 items-start"><input type="checkbox" checked={combineName} onChange={event=>{setCombineName(event.target.checked);setMapping(current=>({...current,full_name:-1}));setPreview([])}} />Combine separate first and last name columns</label>{combineName && nameColumns.map((value,part)=><label className="block" key={part}>{part === 0 ? "Staff first name column" : "Staff last name column"}<select className="rj-input mt-1 w-full" value={value} onChange={event=>{setNameColumns(current=>part===0?[Number(event.target.value),current[1]]:[current[0],Number(event.target.value)]);setPreview([])}}><option value={-1}>Not mapped</option>{csv[0].map((header,index)=><option key={index} value={index}>{header}</option>)}</select></label>)}</>}
      {source !== "generic" && <>
        <label className="block">Source status column (optional)<select className="rj-input mt-1 w-full" value={sourceStatus} onChange={event=>{setSourceStatus(Number(event.target.value));setPreview([]);setActiveReviewed(false)}}><option value={-1}>Not included</option>{csv[0].map((header,index)=><option key={index} value={index}>{header}</option>)}</select></label>
        {sourceStatus >= 0 ? <p className="text-sm">Only active, current, or enrolled rows are eligible. Blank, inactive, archived, and unknown statuses are excluded. Source account activation does not establish ReJoyce readiness.</p> : <label className="flex gap-2 items-start"><input type="checkbox" checked={activeReviewed} onChange={event=>{setActiveReviewed(event.target.checked);setPreview([])}} />I reviewed the exported roster and included only the people I intend to import or invite.</label>}
        {kind === "staff" && mapping.role >= 0 && <div className="space-y-3"><h3 className="font-semibold">Map exported roles</h3><p className="text-sm">Choose a ReJoyce role for each exported role. Unmapped roles are invalid; owner/admin invitations require the individual invitation screen.</p>{[...new Set(csv.slice(1).map(cells=>cells[mapping.role] || ""))].filter(Boolean).map(role=><label className="block" key={role}>ReJoyce role for {role}<select className="rj-input mt-1 w-full" value={Object.hasOwn(roleMapping,role)?roleMapping[role]:""} onChange={event=>{setRoleMapping(current=>({...current,[role]:event.target.value}));setPreview([])}}><option value="">Do not import this role</option>{importRoles.map(value=><option key={value} value={value}>{value}</option>)}</select></label>)}</div>}
      </>}
      <button className="rj-button rj-button-secondary" disabled={!allowed} onClick={() => void inspect()}>Preview import</button>
    </fieldset>}
    {preview.length > 0 && <section className="rj-card space-y-4 p-5"><h2 className="rj-heading-3">3. Review and confirm</h2>
      <p>{ready.length} ready; {preview.filter(row => row.error).length} invalid; {preview.filter(row => row.done).length} completed or skipped.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Import preview and results</caption><thead><tr><th className="p-2">Source row</th>{fields.map(field => <th className="p-2" key={field}>{field.replaceAll("_", " ")}</th>)}<th className="p-2">Status</th></tr></thead><tbody>{preview.map(row => <tr key={row.row} className="border-t"><td className="p-2">{row.row}</td>{fields.map(field => <td className="p-2" key={field}>{row.values[field]}</td>)}<td className="p-2" aria-live="polite">{row.status}</td></tr>)}</tbody></table></div>
      <p className="text-sm">{kind === "staff" ? t("Confirming requests account setup invitations for the ready rows. Delivery is unverified and staff are not automatically ready for sessions. A failure or email limit pauses the batch; remaining ready rows can be continued. Review uncertain rows in People before using the individual invitation screen to retry.") : t("Confirming creates the ready rows in the selected branch. Invalid rows are excluded. Care-team assignments can be added afterward.")}</p>
      <div className="flex flex-wrap gap-3"><SubscriptionWriteControls><button className="rj-button rj-button-primary" disabled={!allowed || busy || !ready.length} onClick={() => void commit()}>{busy ? "Working…" : kind === "staff" ? `Request ${ready.length} invitation(s)` : `Import ${ready.length} ${terms.client_plural.toLowerCase()}`}</button></SubscriptionWriteControls><button className="rj-button rj-button-secondary" disabled={busy} onClick={() => download("rejoyce-import-report.csv", csvReport(preview.map(row => ({ row: row.row, status: row.status }))))}>Download row report</button></div>
    </section>}
    </>}
  </div>
}
