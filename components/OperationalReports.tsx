"use client"
import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { reports } from "@/lib/feature-registry"
import { reportAvailable, type EffectiveCapabilities } from "@/lib/effective-capabilities"
import { reportCell, reportColumns, reportCsv, type ReportId, type ReportResult } from "@/lib/operational-reports"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { useBranches } from "@/components/BranchProvider"
import { usePortal } from "@/components/PortalProvider"
import PageTour from "@/components/PageTour"

export default function OperationalReports() {
  const { data: capabilities, loading: checking, error: accessError, refresh } = useEffectiveCapabilities()
  const { branches, error: branchError } = useBranches()
  const { t } = usePortal()
  const [selected, setSelected] = useState<ReportId | null>(null)
  const [branch, setBranch] = useState("")
  const [status, setStatus] = useState("")
  const [search, setSearch] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<{ key: string; data: ReportResult } | null>(null)
  const [busyScope, setBusyScope] = useState<{ capabilities: EffectiveCapabilities | null; key: string } | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [zone, setZone] = useState("")
  const requests = useRef(0)
  const available = reports.filter(report => reportAvailable(report.id, capabilities))
  const report = selected && available.some(report => report.id === selected) ? selected : available[0]?.id as ReportId | undefined
  const definition = available.find(item => item.id === report)
  const start = from || capabilities?.reportingToday || ""
  const end = to || capabilities?.reportingToday || ""
  const key = JSON.stringify([capabilities?.userId, capabilities?.organizationId, capabilities?.reportingTimezone, report, branch, status, search, start, end, page])
  const busy = busyScope !== null && busyScope.capabilities === capabilities && busyScope.key === key
  const current = result?.key === key ? result.data : null
  useEffect(() => {
    const counter = requests
    // Permission/identity changes invalidate pending screen and download work.
    counter.current++
    return () => { counter.current++ }
  }, [capabilities])
  useEffect(() => {
    const counter = requests
    const device = (event: Event) => { if ((event as CustomEvent<string>).detail !== "unlocked") counter.current++ }
    window.addEventListener("rejoyce:device-state", device)
    return () => window.removeEventListener("rejoyce:device-state", device)
  }, [])
  const run = async (download = false, requestedPage = page) => {
    if (!report || !reportAvailable(report, capabilities)) return
    const request = ++requests.current
    const responseKey = JSON.stringify([capabilities?.userId, capabilities?.organizationId, capabilities?.reportingTimezone, report, branch, status, search, start, end, requestedPage])
    setBusyScope({ capabilities, key: responseKey }); setError(""); setNotice(""); setResult(null)
    try {
      const { data, error: failure } = await supabase.rpc("operational_report", {
        p_report: report, p_from: report === "D3" ? start || null : null, p_to: report === "D3" ? end || null : null,
        p_branch: branch || null, p_status: status || null, p_search: search, p_page: requestedPage,
      })
      if (request !== requests.current) return
      if (failure) throw new Error(failure.message)
      if (!data || data.report !== report || !Array.isArray(data.rows) || data.rows.length>100 || typeof data.hasMore !== "boolean") throw new Error("Unexpected report response. Please retry.")
      const next = data as ReportResult
      setResult({ key: responseKey, data: next })
      if (download) {
        const url = URL.createObjectURL(new Blob([reportCsv(next, { branch: branches.find(item => item.id === branch)?.name || branch, status, search })], { type: "text/csv;charset=utf-8" }))
        const anchor = document.createElement("a")
        anchor.href = url; anchor.download = `rejoyce-${report}-page-${requestedPage+1}.csv`; anchor.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNotice(`Exported page ${requestedPage+1}. The export was freshly checked against your current access.`)
      }
    } catch (cause) { if (request === requests.current) setError(cause instanceof Error ? cause.message : "Unable to load report. Retry.") }
    finally { if (request === requests.current) setBusyScope(null) }
  }
  const change = (update: () => void) => { requests.current++; setBusyScope(null); setError(""); setNotice(""); setPage(0); update() }
  const saveZone = async () => {
    const request = ++requests.current
    setBusyScope({ capabilities, key }); setError(""); setNotice("")
    try {
      const { error } = await supabase.rpc("set_reporting_timezone", { p_timezone: zone.trim() })
      if (request !== requests.current) return
      if (error) throw new Error(error.message)
      setNotice("Organization reporting timezone saved.")
      await refresh()
    } catch (cause) { if (request === requests.current) setError(cause instanceof Error ? cause.message : "Unable to save timezone.") }
    finally { setBusyScope(null) }
  }
  if (checking) return <p role="status">Checking report access…</p>
  if (accessError || !capabilities) return <div role="alert">{accessError || "Unlock your device to load reports."} <button className="underline" onClick={() => void refresh()}>Retry access</button></div>
  if (!capabilities.reports) return <p>Report access is required. Ask an administrator about your permissions.</p>
  return <div className="space-y-5">
    <header data-tour="reports-heading"><p className="rj-label">Operations</p><h1 className="rj-heading-1">Reports</h1><p className="mt-2">Current people and staff snapshots, plus recorded scheduling activity.</p></header>
    <PageTour family="reports" />
    {available.length === 0 ? <p>Your report grant does not include source management access. Ask an administrator about People, staff or schedule authority.</p> : <>
      <section aria-label="Report library" data-tour="reports-library" className="grid gap-3 md:grid-cols-3">{available.map(item => <button key={item.id} type="button" aria-pressed={report === item.id} onClick={() => change(() => { setSelected(item.id as ReportId); setStatus("") })} className={`rj-card p-4 text-left ${report === item.id ? "ring-2 ring-teal-700" : ""}`}><span className="text-sm">{item.id}</span><span className="mt-1 block font-semibold">{t(item.title)}</span></button>)}</section>
      <section className="rj-card space-y-3 p-5" data-tour="reports-definition"><h2 className="rj-heading-2">{t(definition?.title || "Report")}</h2><p>{definition?.interpretation}</p><p className="text-sm">Source authority is checked on every run and export. Branch filters use current membership. Each page contains at most 100 records; exports contain only that page.</p></section>
      <section className="rj-card space-y-3 p-5" aria-label="Reporting timezone" data-tour="reports-timezone">
        <p><strong>Organization reporting timezone:</strong> {capabilities.reportingTimezone || "Not configured"}</p>
        <p className="text-sm">Schedule date boundaries use this timezone, including daylight-saving changes. Roster and staff reports are current snapshots. Calendar and legacy Tasks retain their existing day handling.</p>
        {capabilities.sessions && <details><summary className="cursor-pointer underline">Configure reporting timezone</summary><p className="mt-3">Choose the IANA timezone your organization uses for reporting, such as America/Chicago or Europe/London. This affects report date boundaries for everyone.</p><label className="mt-3 block">IANA timezone<input className="mt-1 block w-full max-w-md rounded border p-2" placeholder="Area/City" value={zone} onChange={event => setZone(event.target.value)} disabled={busy || !capabilities.canWrite} /></label><button className="rj-button rj-button-secondary mt-3" disabled={busy || !capabilities.canWrite || !zone.trim()} onClick={() => void saveZone()}>Save reporting timezone</button>{!capabilities.canWrite && <p>Read-only subscription access prevents setting changes.</p>}</details>}
        {report === "D3" && !capabilities.reportingTimezone && <p role="status">A schedule manager must configure the organization reporting timezone before this report can run.</p>}
      </section>
      <form className="rj-card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3" data-tour="reports-filters" onSubmit={event => { event.preventDefault(); void run() }}>
        <label>Current branch membership<select className="mt-1 block min-h-11 w-full rounded border p-2" value={branch} onChange={event => change(() => setBranch(event.target.value))}><option value="">All current branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Name contains<input type="search" maxLength={100} className="mt-1 block min-h-11 w-full rounded border p-2" value={search} onChange={event => change(() => setSearch(event.target.value))} /></label>
        <label>{report === "D3" ? "Recorded activity status" : "Current status"}<select className="mt-1 block min-h-11 w-full rounded border p-2" value={status} onChange={event => change(() => setStatus(event.target.value))}><option value="">All statuses</option>{(report === "D3" ? ["scheduled", "confirmed", "in_progress", "paused", "completed", "canceled", "client_absent", "provider_absent", "no_show"] : report === "D2" ? ["active", "inactive", "invited", "disabled", "locked"] : ["active", "inactive", "archived"]).map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        {report === "D3" && <><label>From local date<input type="date" required className="mt-1 block min-h-11 w-full rounded border p-2" value={start} onChange={event => change(() => setFrom(event.target.value))} /></label><label>Through local date<input type="date" required className="mt-1 block min-h-11 w-full rounded border p-2" value={end} onChange={event => change(() => setTo(event.target.value))} /></label></>}
        <div className="flex flex-wrap items-end gap-3"><button className="rj-button rj-button-primary" disabled={busy || (report === "D3" && !capabilities.reportingTimezone)}>{busy ? "Working…" : "Run report"}</button><button type="button" data-tour="reports-export" className="rj-button rj-button-secondary" disabled={busy || !current || current.rows.length === 0} onClick={() => void run(true)}>Export this page as CSV</button></div>
      </form>
      {branchError && <p role="alert">Branch options could not be loaded. Retry your branch connection before selecting a branch.</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <section className="rj-card space-y-3 p-5" data-tour="reports-results" aria-busy={busy} aria-label="Report results">
        {!current ? <p role="status">Choose filters and run the report. Changing filters clears the displayed results.</p> : <>
          <p>Page {current.page+1} · {current.rows.length} records on this page · Generated {new Date(current.asOf).toLocaleString()} · {current.timezone || "Current snapshot"}</p>
          {current.rows.length === 0 ? <p>No matching records. This is not evidence of attendance or completed setup.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{definition?.title}, page {page+1}</caption><thead><tr>{reportColumns[current.report].map(column => <th key={column.key} scope="col" className="border-b p-3">{t(column.label)}</th>)}</tr></thead><tbody>{current.rows.map(row => <tr key={String(row.id)}>{reportColumns[current.report].map(column => <td key={column.key} className="border-b p-3">{reportCell(row[column.key], column.key, current.timezone)}</td>)}</tr>)}</tbody></table></div>}
          <div className="flex flex-wrap gap-3"><button className="rj-button rj-button-secondary" disabled={busy || page === 0} onClick={() => { setPage(page-1); void run(false,page-1) }}>Previous page</button><button className="rj-button rj-button-secondary" disabled={busy || !current.hasMore} onClick={() => { setPage(page+1); void run(false,page+1) }}>Next page</button></div><p className="text-sm">Each page is a fresh snapshot; records can change between pages.</p>
        </>}
      </section>
    </>}
  </div>
}
