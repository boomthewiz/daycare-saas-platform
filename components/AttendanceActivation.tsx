"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
type Activation = { organizationId: string; actorId: string; userId: string; name: string; owner: boolean; active: boolean; admin: boolean; timezone: string | null; canWrite: boolean; view: boolean; record: boolean; correct: boolean; ready: boolean; ownerReady: boolean | null; canSetTimezone: boolean; canManageClients: boolean; canManageBranches: boolean; branches: { id: string; name: string; active: boolean; assigned: boolean; hasChild: boolean }[]; staff: { id: string; name: string }[] }
export default function AttendanceActivation({ revision }: { revision: number }) {
  const { data: caps } = useEffectiveCapabilities()
  const [selected, setSelected] = useState("")
  const [data, setData] = useState<Activation | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const scope = caps ? `${caps.organizationId}:${caps.userId}` : ""
  const previousScope = useRef(scope)
  const load = useCallback(async () => {
    const request = ++generation.current
    setData(null); setError(""); setBusy(false)
    if (!scope) return
    const user = previousScope.current === scope ? selected : ""
    previousScope.current = scope
    if (user !== selected) setSelected("")
    setBusy(true)
    try {
      const result = await supabase.rpc("attendance_activation", { p_user: user || null })
      if (request !== generation.current) return
      if (result.error || !result.data || !Array.isArray(result.data.branches) || typeof result.data.ready !== "boolean") throw new Error(result.error?.message || "Unable to verify readiness.")
      if (result.data.organizationId !== caps?.organizationId || result.data.actorId !== caps?.userId) throw new Error("Account changed. Refresh access.")
      setData(result.data as Activation)
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "Readiness unavailable.") }
    finally { if (request === generation.current) setBusy(false) }
  }, [scope, selected, caps?.organizationId, caps?.userId])
  useEffect(() => {
    const counter = generation
    void load()
    const device = (event: Event) => { if ((event as CustomEvent<string>).detail === "unlocked") void load(); else { generation.current++; setData(null); setBusy(false); setError("") } }
    const refresh = () => { if (!document.hidden) void load() }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => { generation.current++; setData(null); if (event !== "INITIAL_SESSION" && event !== "TOKEN_REFRESHED") setSelected(""); setError(""); setBusy(false); window.setTimeout(refresh, 0) })
    window.addEventListener("rejoyce:device-state", device); window.addEventListener("focus", refresh); window.addEventListener("rejoyce:capabilities-changed", refresh)
    return () => { counter.current++; subscription.unsubscribe(); window.removeEventListener("rejoyce:device-state", device); window.removeEventListener("focus", refresh); window.removeEventListener("rejoyce:capabilities-changed", refresh) }
  }, [load, revision])
  return <section id="attendance-activation" aria-label="Attendance activation checklist" className="rj-card space-y-3 p-5" aria-busy={busy}>
    <h2 className="rj-heading-2">Attendance activation checklist</h2>
    <p>Configuration for recording a new branch visit. Viewing this checklist changes no settings, grants or visits.</p>
    <button className="rj-button rj-button-secondary" disabled={busy} onClick={() => void load()}>Refresh readiness</button>
    {busy && <p role="status">Verifying configuration…</p>}{error && <p role="alert">Readiness unverified: {error} Retry after unlocking or reviewing access.</p>}
    {data && <>
      {data.admin && <><p>Owner configuration: {data.ownerReady ? "Ready for an active owner to record visits" : "Not ready for new visits"}. An owner-only organization does not need additional staff.</p><p>Organization-wide rollout is not certified here. Review each intended recorder and each operating branch separately; a ready owner does not establish staff readiness.</p>
        <label className="block">Recorder to check<select className="rj-input" value={selected} onChange={event => { generation.current++; setData(null); setSelected(event.target.value) }}><option value="">My account</option>{data.staff.map(user => <option key={user.id} value={user.id}>{user.name || user.id}</option>)}</select></label></>}
      <p role="status"><strong>{data.userId === data.actorId ? "My recorder readiness" : `Selected recorder: ${data.name}`} — {data.ready ? "Ready for new visits in at least one eligible branch" : "Not ready for new visits"}</strong></p>
      <ul className="list-disc space-y-2 pl-5">
        <li>{data.timezone ? `Configured IANA reporting timezone: ${data.timezone}` : "Missing: explicit organization reporting timezone."} {data.canSetTimezone ? <Link className="underline" href="/reports">Configure timezone in Reports</Link> : "Ask an authorized scheduling administrator to configure it."}</li>
        <li>Account: {data.active ? "active" : "inactive"}. Editing subscription: {data.canWrite ? "available" : "unavailable — new visits cannot be recorded"}.</li>
        <li>Grants: View {data.view ? "yes" : "missing"}; Record {data.record ? "yes" : "missing"}; Correct {data.correct ? "yes" : "not granted (optional for recording)"}. Record and Correct never imply View. Correction requires View and appropriate attendance branches, and only owner/admin may change correction authority. {data.admin && <Link className="underline" href={`/team-management/${data.userId}`}>Review account grants</Link>}</li>
        <li>{data.owner ? "Owner authority covers organization branches; separate staff scope is not required for the owner." : "Dedicated attendance branches must be assigned separately. Care-team membership and staff locations do not count."} {data.admin && <a className="underline" href="#attendance-branch-access">Review attendance branches</a>}</li>
        <li>At least one active, authorized branch must have an active child member. {data.canManageBranches && <Link className="underline" href="/setup/preferences?tab=locations">Review branches</Link>} {data.canManageClients ? <Link className="underline" href="/team-management?tab=clients"> Review child membership</Link> : "Ask an authorized child administrator to review missing membership."}</li>
      </ul>
      {!data.branches.length && <p>No dedicated attendance branches available for this recorder.</p>}
      <ul className="space-y-1">{data.branches.map(branch => <li key={branch.id}>{branch.name}: {branch.active ? "active" : "inactive"}; {branch.assigned ? "authorized branch" : "attendance assignment missing"}; {branch.hasChild ? "active child membership available" : "active child membership missing"}.</li>)}</ul>
      <p className="text-sm">Readiness is configuration, not proof of an unlocked staff device or a recorded visit. The server rechecks current authority, device lock, subscription, branch and child when recording.</p>
    </>}
  </section>
}
