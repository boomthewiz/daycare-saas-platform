"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { useScheduleConflictReview } from "@/components/ScheduleConflictReview"
import ScheduleTimeReview from "@/components/ScheduleTimeReview"
import { useScheduleClock } from "@/components/SchedulingTimezoneProvider"
import { resolveCivil, zonedCivil, zonedLabel } from "@/lib/scheduling-timezone"
import SessionTags from "@/components/SessionTags"

type Activity = { id: string; child_name: string; provider_name: string | null; updated_at: string; workflow_intent: string; session_type: string; scheduled_start: string; scheduled_end: string; location: string | null; status: string; group_activity?: boolean; class_id?: string; class_name?: string; version?: number; children?: {id:string;name:string}[]; staff?: {id:string;name:string}[] }
export default function ActivityWorkspace({ sessionId, editing = false }: { sessionId: string; editing?: boolean }) {
  const scheduleClock=useScheduleClock()
  const [startOccurrence,setStartOccurrence]=useState("")
  const [endOccurrence,setEndOccurrence]=useState("")
  const conflictReview=useScheduleConflictReview()
  const { data: caps } = useEffectiveCapabilities()
  const [activity, setActivity] = useState<Activity | null>(null)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [location, setLocation] = useState("")
  const [status, setStatus] = useState("confirmed")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const scope = caps ? `${caps.organizationId}:${caps.userId}` : ""
  const load = useCallback(async () => {
    const request = ++generation.current
    setActivity(null); setNotice(""); setError(""); setBusy(false)
    if (!scope || !scheduleClock.timezone) return
    const result = await supabase.rpc("activity_schedule", { p_session: sessionId })
    if (request !== generation.current) return
    if (result.error || result.data?.workflow_intent !== "activity") { setError("Activity unavailable. Unlock your device and retry."); return }
    const value = result.data as Activity
    setStartOccurrence(new Date(value.scheduled_start).toISOString());setEndOccurrence(new Date(value.scheduled_end).toISOString());
    setActivity(value); setStart(zonedCivil(value.scheduled_start,scheduleClock.timezone)); setEnd(zonedCivil(value.scheduled_end,scheduleClock.timezone)); setLocation(value.location || ""); setStatus(value.status)
    return true
  }, [scope, sessionId, scheduleClock.timezone])
  useEffect(() => {
    const counter = generation
    void load()
    const device = (event: Event) => { if ((event as CustomEvent<string>).detail === "unlocked") void load(); else { generation.current++; setActivity(null); setBusy(false); setNotice("") } }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { generation.current++; setActivity(null); setNotice(""); setBusy(false); window.setTimeout(() => void load(), 0) })
    window.addEventListener("rejoyce:device-state", device)
    return () => { counter.current++; subscription.unsubscribe(); window.removeEventListener("rejoyce:device-state", device) }
  }, [load])
  return <section className="rj-card mx-auto max-w-2xl space-y-4 break-words p-5">
    {conflictReview.dialog}
    <Link href={caps?.sessions ? "/sessions" : "/my-sessions"} className="underline">Back to schedule</Link>
    <h1 className="rj-heading-1">{activity?.group_activity ? "Group activity" : "Ordinary activity"}</h1>
    {scheduleClock.error&&<p role="status">{scheduleClock.error}</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status" className="rj-feedback">{notice}</p>}
    <button className="underline" disabled={busy} onClick={() => void load()}>Refresh activity</button>
    {activity && <><h2 className="rj-heading-2">{activity.child_name}</h2><p>{activity.group_activity ? "Assigned staff" : "Assigned team member"}: {activity.provider_name || "Assigned staff"}</p><p>Activity scheduled · {activity.session_type.replaceAll("_", " ")} · {activity.status.replaceAll("_", " ")}</p>
      <p>{zonedLabel(activity.scheduled_start,scheduleClock.timezone)} – {zonedLabel(activity.scheduled_end,scheduleClock.timezone)} · {activity.location || "No location"}</p>
      <p>No treatment targets, clinical execution or clinical note required. This schedule does not record attendance or workforce hours.</p>
      {activity.group_activity && <section className="space-y-3"><p>Class: {activity.class_name} · {activity.children?.length} children</p><h3 className="font-semibold">Activity roster</h3><ul>{activity.children?.map(child=><li key={child.id}>{child.name}</li>)}</ul><p className="text-sm">This roster was reviewed when scheduled. Later class edits do not change it.</p>{caps?.clients && <Link className="underline" href="/classes">View classes</Link>}</section>}
      {caps?.sessions && !activity.group_activity && <SessionTags sessionId={sessionId} />}
      {!editing && caps?.sessions && <Link className="rj-button rj-button-secondary" href={activity.group_activity ? `/activity/${sessionId}?edit=1` : `/sessions/${sessionId}/edit`}>Edit activity schedule</Link>}
      {editing && caps?.sessions && <form className="space-y-3" onSubmit={async event => {
        event.preventDefault(); const request = ++generation.current; setBusy(true); setError(""); setNotice("")
        try {
          if(!scheduleClock.valid)throw new Error(scheduleClock.error)
          const from = new Date(resolveCivil(start,scheduleClock.timezone,startOccurrence,activity.scheduled_start)), to = new Date(resolveCivil(end,scheduleClock.timezone,endOccurrence,activity.scheduled_end))
          if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 86400000) throw new Error("Choose valid times within 24 hours.")
          const data = await conflictReview.save(activity.group_activity?"update_group":"update_session",activity.group_activity?{p_activity:sessionId,p_version:activity.version,p_start:from.toISOString(),p_end:to.toISOString(),p_location:location.trim()||null,p_status:status}:{p_session:sessionId,p_version:activity.updated_at,p_changes:{scheduled_start:from.toISOString(),scheduled_end:to.toISOString(),location:location.trim()||null,status}})
          if(!data)return
          if (request !== generation.current) return
          if (!data.id) throw new Error("Activity changed or access expired. Refresh and retry.")
          if (await load()) setNotice("Activity schedule saved.")
          window.dispatchEvent(new Event("rejoyce:schedule-changed"))
        } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "Unable to save activity.") }
        finally { if (request === generation.current) setBusy(false) }
      }}>
        <ScheduleTimeReview start={start} end={end} startOccurrence={startOccurrence} endOccurrence={endOccurrence} onStartOccurrence={setStartOccurrence} onEndOccurrence={setEndOccurrence}/>
        <label className="block">Start (organization time)<input className="rj-input" required type="datetime-local" step="0.001" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="block">End (organization time)<input className="rj-input" required type="datetime-local" step="0.001" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <label className="block">Location<input className="rj-input" maxLength={120} value={location} onChange={e => setLocation(e.target.value)} /></label>
        <label className="block">Schedule status<select className="rj-input" value={status} onChange={e => setStatus(e.target.value)}>{["scheduled", "confirmed", "canceled"].map(value => <option key={value}>{value}</option>)}</select></label>
        <button className="rj-button rj-button-primary" disabled={busy || !scheduleClock.valid || !caps.canWrite || !["scheduled", "confirmed"].includes(activity.status)}>Save activity schedule</button>
      </form>}
    </>}
  </section>
}
