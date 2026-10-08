"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useSetupAccess } from "@/lib/use-setup-access"
import { useBranches } from "@/components/BranchProvider"
import { usePortal } from "@/components/PortalProvider"
import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"
import { clientFields, staffFields, importRoles, parseCsv, validateImportRows, csvReport, type ImportKind, type ImportRow } from "@/lib/people-import"

type PreviewRow = ImportRow & { status: string; done?: boolean }
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a"); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function PeopleImportPage() {
  const access = useSetupAccess(), branches = useBranches(), { terms } = usePortal()
  const [kind, setKind] = useState<ImportKind>("clients")
  const [csv, setCsv] = useState<string[][]>([]), [mapping, setMapping] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<PreviewRow[]>([]), [branch, setBranch] = useState("")
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
  function reset(next: ImportKind) { setKind(next); setCsv([]); setPreview([]); setFileName(""); setError(""); setMessage(""); setMapping({}) }
  async function read(file: File | undefined) {
    setError(""); setMessage(""); setCsv([]); setPreview([]); setFileName("")
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 1024 * 1024) throw new Error("Choose a CSV smaller than 1 MB.")
      const rows = parseCsv(await file.text())
      setMapping(Object.fromEntries(fields.map(field => [field, rows[0].findIndex(header => header.trim().toLowerCase().replace(/\s+/g, "_") === field)])))
      setCsv(rows); setFileName(file.name)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to read this CSV.") }
    finally { setBusy(false) }
  }
  async function inspect() {
    setError(""); setMessage(""); setPreview([]); setBusy(true)
    try {
      if (!allowed) throw new Error("You do not have permission to import these people.")
      if (kind === "clients" && (!branch || branches.loading || branches.error || !branches.branches.some(item => item.id === branch))) throw new Error("Choose an active branch for these clients. Create a branch in Setup if needed.")
      const rows = validateImportRows(csv, kind, mapping)
      const org = await supabase.rpc("current_organization_id")
      if (org.error || !org.data) throw new Error("Unlock your session and try again.")
      const keys = rows.filter(row => !row.error).map(row => kind === "clients" ? row.values.external_id : row.values.email)
      const existing = keys.length ? await supabase.from(kind === "clients" ? "clients" : "users").select(kind === "clients" ? "import_external_id" : "email").eq("organization_id", org.data).in(kind === "clients" ? "import_external_id" : "email", keys) : { data: [], error: null }
      if (existing.error) throw new Error(existing.error.message)
      const found = new Set((existing.data as unknown as Record<string, string>[] || []).map(item => kind === "clients" ? item.import_external_id : item.email?.toLowerCase()))
      setPreview(rows.map(row => ({ ...row, status: row.error || (found.has(kind === "clients" ? row.values.external_id : row.values.email) ? "Already exists — skipped" : "Ready"), done: found.has(kind === "clients" ? row.values.external_id : row.values.email) })))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to preview the import.") }
    finally { setBusy(false) }
  }
  function update(rowNumber: number, status: string, done = false) { setPreview(current => current.map(row => row.row === rowNumber ? { ...row, status, done } : row)) }
  async function commit() {
    if (!allowed || !ready.length) return
    setBusy(true); setError(""); setMessage("")
    try {
      if (kind === "clients") {
        const result = await supabase.rpc("import_clients", { p_rows: ready.map(row => row.values), p_location_id: branch })
        if (result.error) throw new Error(result.error.message)
        for (const item of result.data as { external_id: string; status: string }[]) {
          const row = ready.find(row => row.values.external_id === item.external_id)
          if (row) update(row.row, item.status === "created" ? "Created" : "Already exists — skipped", true)
        }
        setMessage("Client import completed. Add care-team assignments in People when ready.")
      } else {
        let sent = 0
        for (const row of ready) {
          if (!mounted.current) break
          update(row.row, "Sending…")
          // Fetch a current token for each invitation; the existing endpoint checks device,
          // subscription, role delegation, conflicts and durable email limits again.
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) { update(row.row, "Not sent — sign in before continuing"); throw new Error("Your login expired. Sign in before continuing.") }
          let response: Response
          try { response = await fetch("/api/invite-user", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fullName: row.values.full_name, email: row.values.email, role: row.values.role }) }) }
          catch { update(row.row, "Delivery uncertain — check People and the inbox before resending"); throw new Error("Connection interrupted. Invitations paused; review the row report before continuing.") }
          let result: { error?: string; code?: string }
          try { result = await response.json() }
          catch { update(row.row, "Delivery uncertain — check People and the inbox before resending"); throw new Error("The invitation response was interrupted. Review People before retrying.") }
          if (response.ok) { update(row.row, "Invitation sent", true); sent++ }
          else if (response.status === 409 && result.code === "USER_ALREADY_IN_ORGANIZATION") update(row.row, "Already exists — skipped", true)
          else { update(row.row, result.error || "Invitation failed — review before retrying"); throw new Error(result.error || "Invitations paused. Remaining rows have not been sent.") }
        }
        setMessage(`${sent} invitation(s) sent. Existing accounts were skipped.`)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to finish the import. Review the row report.") }
    finally { setBusy(false) }
  }
  const template = kind === "clients" ? "external_id,first_name,last_name,preferred_name\r\nC-001,Sam,Example,Sam" : "full_name,email,role\r\nAlex Example,alex@example.invalid,teacher"
  return <div className="mx-auto max-w-5xl space-y-5">
    <Link href="/team-management" className="underline">Back to People</Link><h1 className="rj-heading-1">Import people</h1>
    <p>Upload a CSV, match its columns, and preview the results. Import up to 100 people per file.</p>
    {(error || access.error || branches.error) && <p role="alert" className="rounded-xl bg-red-50 p-3">{error || access.error || branches.error}</p>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-3">{message}</p>}
    <fieldset disabled={busy} className="rj-card space-y-4 p-5">
      <legend className="font-semibold">1. Choose a list</legend>
      <label className="block">People to import<select className="rj-input mt-1 w-full" value={kind} onChange={event => reset(event.target.value as ImportKind)}><option value="clients">{terms.client_plural}</option><option value="staff">{terms.frontline_plural}</option></select></label>
      {!allowed && !access.loading && <p>Management permission is required for this list.</p>}
      <button className="rj-button rj-button-secondary" onClick={() => download(`rejoyce-${kind}-template.csv`, template)}>Download CSV template</button>
      {kind === "clients" ? <><p className="text-sm">Use a stable, unique external ID from your existing system for each person. Repeat uploads skip matching IDs without overwriting records. People created manually should be reviewed before importing.</p><label className="block">Branch for this list<select className="rj-input mt-1 w-full" value={branch} onChange={event => { setBranch(event.target.value); setPreview([]) }}><option value="">Choose an active branch</option>{branches.branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Link className="underline" href="/setup/preferences">Manage branches in Setup</Link></> : <p className="text-sm">Supported roles: {importRoles.join(", ")}. Review roles before sending. Invitations use the same permissions and email limits as individual invitations. Owner and admin accounts are added individually.</p>}
      <label className="block">CSV file<input key={kind} className="mt-2 block w-full" type="file" accept=".csv,text/csv" disabled={!allowed} onChange={event => void read(event.target.files?.[0])} /></label>
      {fileName && <p className="text-sm">{fileName}: {csv.length - 1} rows loaded.</p>}
    </fieldset>
    {csv.length > 0 && <fieldset disabled={busy} className="rj-card space-y-4 p-5"><legend className="font-semibold">2. Match columns</legend>
      {fields.map(field => <label className="block" key={field}>{field.replaceAll("_", " ")}{["external_id", "first_name", "full_name", "email", "role"].includes(field) ? " (required)" : " (optional)"}<select className="rj-input mt-1 w-full" value={mapping[field] ?? -1} onChange={event => { setMapping(current => ({ ...current, [field]: Number(event.target.value) })); setPreview([]) }}><option value={-1}>Not mapped</option>{csv[0].map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label>)}
      <button className="rj-button rj-button-secondary" disabled={!allowed} onClick={() => void inspect()}>Preview import</button>
    </fieldset>}
    {preview.length > 0 && <section className="rj-card space-y-4 p-5"><h2 className="rj-heading-3">3. Review and confirm</h2>
      <p>{ready.length} ready; {preview.filter(row => row.error).length} invalid; {preview.filter(row => row.done).length} completed or skipped.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Import preview and results</caption><thead><tr><th className="p-2">CSV row</th>{fields.map(field => <th className="p-2" key={field}>{field.replaceAll("_", " ")}</th>)}<th className="p-2">Status</th></tr></thead><tbody>{preview.map(row => <tr key={row.row} className="border-t"><td className="p-2">{row.row}</td>{fields.map(field => <td className="p-2" key={field}>{row.values[field]}</td>)}<td className="p-2" aria-live="polite">{row.status}</td></tr>)}</tbody></table></div>
      <p className="text-sm">{kind === "staff" ? "Confirming sends account setup emails to the ready rows. A delivery limit pauses the batch; remaining ready rows can be continued later." : "Confirming creates the ready rows in the selected branch. Invalid rows are excluded. Care-team assignments can be added afterward."}</p>
      <div className="flex flex-wrap gap-3"><SubscriptionWriteControls><button className="rj-button rj-button-primary" disabled={!allowed || busy || !ready.length} onClick={() => void commit()}>{busy ? "Working…" : kind === "staff" ? `Send ${ready.length} invitation(s)` : `Import ${ready.length} ${terms.client_plural.toLowerCase()}`}</button></SubscriptionWriteControls><button className="rj-button rj-button-secondary" disabled={busy} onClick={() => download("rejoyce-import-report.csv", csvReport(preview.map(row => ({ row: row.row, status: row.status }))))}>Download row report</button></div>
    </section>}
  </div>
}
