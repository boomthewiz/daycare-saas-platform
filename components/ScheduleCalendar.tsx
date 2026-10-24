"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useServiceModel } from "@/components/ServiceModelProvider"
import { matchesFocus, modelDefaults, scheduleLabel, type CalendarFocus, type SchedulingKind } from "@/lib/schedule-intent"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, LoaderCircle, Plus, RefreshCw } from "lucide-react"
import { usePortal } from "@/components/PortalProvider"
import { useBranches } from "@/components/BranchProvider"
import { useOrganizationWriteAccess } from "@/components/SubscriptionWriteControls"
import { supabase } from "@/lib/supabase"
import { addDays, localDate, localDateTime, parseLocalDate, placeEvents, weekStart } from "@/lib/calendar"
import { readCalendarSessions, type CalendarSession } from "@/lib/calendar-data"

function subscribeMobile(callback: () => void) {
  const media = window.matchMedia("(max-width: 639px)")
  media.addEventListener("change", callback)
  return () => media.removeEventListener("change", callback)
}
const dateLabel = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
const timeLabel = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
const clientName = (session: CalendarSession) => session.activity_title || session.clients?.preferred_name || session.clients?.first_name || "Assigned client"
const terminalStatuses = ["canceled", "client_absent", "provider_absent", "no_show"]

export default function ScheduleCalendar() {
  const { t } = usePortal()
  const { data: account, error: accountError, refresh: refreshAccount } = useServiceModel()
  const [preference, setPreference] = useState<{scope:string;focus:CalendarFocus}|null>(null)
  const [draft, setDraft] = useState<{scope:string;params:string}|null>(null)
  const router = useRouter()
  const branch = useBranches()
  const { allowed } = useOrganizationWriteAccess()
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia("(max-width: 639px)").matches, () => false)
  const accountScope = account ? `${account.organizationId}:${account.userId}` : ""
  const defaults = modelDefaults(account?.model || "unconfirmed")
  const focus = preference?.scope === accountScope ? preference.focus : defaults.focus
  const setFocus = (value: CalendarFocus) => setPreference({scope:accountScope,focus:value})
  const [selection, setSelection] = useState<{ day: number; first: number; last: number } | null>(null)
  const suppressClick = useRef(false)
  const [mode, setMode] = useState<"auto" | "day" | "week" | "range">("auto")
  const [anchor, setAnchor] = useState(() => localDate(new Date()))
  const [rangeEnd, setRangeEnd] = useState(() => localDate(addDays(new Date(), 6)))
  const [sessions, setSessions] = useState<CalendarSession[]>([])
  const [canSchedule, setCanSchedule] = useState(false)
  const [permissionError, setPermissionError] = useState("")
  const [typeNames, setTypeNames] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [activeSlot, setActiveSlot] = useState({ day: 0, slot: 18 })
  const scroller = useRef<HTMLDivElement>(null)
  const view = mode === "auto" ? (defaults.day || mobile ? "day" : "week") : mode
  const selectedDate = parseLocalDate(anchor)
  const selectedEnd = parseLocalDate(rangeEnd)
  const start = selectedDate ? (view === "week" ? weekStart(selectedDate) : selectedDate) : null
  const last = start ? (view === "range" ? selectedEnd : addDays(start, view === "week" ? 6 : 0)) : null
  const dayCount = start && last ? Math.round((Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000) + 1 : 0
  const rangeError = !start || !last || dayCount < 1 || dayCount > 31 ? "Choose a valid date range of 1–31 days." : ""
  const startKey = start ? localDate(start) : ""
  const endKey = last ? localDate(addDays(last, 1)) : ""
  const days = !rangeError && start ? Array.from({ length: dayCount }, (_, index) => addDays(start, index)) : []
  const visibleSessions = account ? sessions.filter(event => matchesFocus(event, focus)) : []
  const agenda = dayCount > 7 || (mobile && dayCount > 1)
  const hourHeight = mobile ? 88 : 64
  const editable = !!account && canSchedule && allowed && !loading && !branch.loading && !branch.error && !error

  useEffect(() => {
    let current = true
    void supabase.rpc("can_manage_sessions").then(({ data, error }) => {
      if (!current) return
      setCanSchedule(!error && data === true)
      setPermissionError(error ? "Unable to check scheduling permissions. Try refreshing." : "")
    })
    void supabase.from("session_types").select("code,name").then(({ data }) => {
      if (current && data) setTypeNames(Object.fromEntries(data.map(type => [type.code, type.name])))
    })
    return () => { current = false }
  }, [revision])

  useEffect(() => {
    let current = true
    setSessions([])
    setLoading(true)
    setError("")
    if (rangeError || branch.loading || branch.error) { setLoading(false); return }
    const floor = parseLocalDate(startKey)!, ceiling = parseLocalDate(endKey)!
    void readCalendarSessions(floor, ceiling, branch.selectedBranchId).then(rows => {
      if (current) setSessions(rows)
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : "Unable to load your calendar.")
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [startKey, endKey, rangeError, branch.selectedBranchId, branch.loading, branch.error, revision])

  useEffect(() => { if (!agenda && scroller.current) scroller.current.scrollTop = 7 * hourHeight }, [agenda, startKey, hourHeight])
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener("rejoyce:schedule-changed", refresh)
    return () => window.removeEventListener("rejoyce:schedule-changed", refresh)
  }, [])

  function createAt(day: Date, minutes: number, endMinutes?: number) {
    if (!editable) return
    const date = new Date(day)
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    const params = new URLSearchParams({ start: localDateTime(date) })
    if (endMinutes !== undefined) {
      const end = new Date(day); end.setMinutes(endMinutes, 0, 0)
      params.set("end", localDateTime(end))
    }
    const kind = focus === "classes" ? "group" : focus === "sessions" ? "clinical" : focus === "activities" ? null : defaults.kind
    if (kind) openDraft(params.toString(), kind)
    else setDraft({scope:accountScope,params:params.toString()})
  }
  function openDraft(query: string, kind: SchedulingKind) {
    if (!editable) return
    const params = new URLSearchParams(query)
    params.set("intent",kind === "clinical" ? "clinical" : "activity")
    if (kind === "group") params.set("group","1")
    setDraft(null)
    router.push(`/sessions?${params}#create-session`)
  }
  function slotAt(clientY: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    return Math.max(0, Math.min(47, Math.floor((clientY - rect.top) / (hourHeight / 2))))
  }
  const eventHref = (event: CalendarSession) => event.group_activity ? `/activity/${event.id}` : canSchedule ? `/sessions/${event.id}` : event.workflow_intent === "activity" ? `/activity/${event.id}` : `/session/${event.id}`
  const serviceName = (session: CalendarSession) => typeNames[session.session_type] || session.session_type
  function move(direction: number) {
    if (!start || !last || rangeError) return
    setAnchor(localDate(addDays(start, direction * dayCount)))
    if (view === "range") setRangeEnd(localDate(addDays(last, direction * dayCount)))
  }
  const refresh = () => { window.dispatchEvent(new Event("rejoyce:schedule-changed")); void branch.reload(); void refreshAccount() }
  const message = rangeError || branch.error || error || permissionError || accountError

  return <section aria-label="Schedule calendar" className="rj-calendar min-w-0 overflow-hidden rounded-2xl border border-[var(--rj-border)] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rj-border)] p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold sm:mr-2">{t("Calendar")}</h1>
        <button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => { const today = new Date(); setAnchor(localDate(today)); setRangeEnd(localDate(addDays(today, Math.max(0, dayCount - 1)))) }}>Today</button>
        <button type="button" aria-label="Previous date range" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100" onClick={() => move(-1)} disabled={!!rangeError}><ChevronLeft size={20} /></button>
        <button type="button" aria-label="Next date range" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100" onClick={() => move(1)} disabled={!!rangeError}><ChevronRight size={20} /></button>
        <p aria-live="polite" className="text-sm font-semibold">{start && last ? `${dateLabel(start)}${dayCount > 1 ? ` – ${dateLabel(last)}` : ""}` : "Choose dates"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="calendar-focus">Schedule focus</label>
        <select id="calendar-focus" className="min-h-11 rounded-lg border bg-white px-3 text-sm" value={focus} onChange={event => { setSelection(null); setFocus(event.target.value as typeof focus) }}>
          <option value="all">All scheduled work</option><option value="classes">Classes · daycare overview</option><option value="activities">Activities · individual and group</option><option value="sessions">ABA · clinical session detail</option>
        </select>
        <label className="sr-only" htmlFor="calendar-view">Calendar view</label>
        <select id="calendar-view" className="min-h-11 rounded-lg border bg-white px-3 text-sm" value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
          <option value="auto">{mobile ? "Day (default)" : "Week (default)"}</option>
          <option value="day">Day</option><option value="week">Week</option><option value="range">Date range</option>
        </select>
        <button type="button" aria-label="Refresh calendar" title="Refresh calendar" onClick={refresh} disabled={loading} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100">{loading ? <LoaderCircle size={18} className="animate-spin" /> : <RefreshCw size={18} />}</button>
        {canSchedule && allowed && <button type="button" disabled={!editable} onClick={() => selectedDate && createAt(selectedDate, 9 * 60)} className="flex min-h-11 items-center gap-1 rounded-lg bg-[var(--rj-teal-700)] px-3 text-sm font-semibold text-white disabled:opacity-50"><Plus size={18} />{"Schedule work"}</button>}
      </div>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[var(--rj-border)] px-3 py-2 sm:px-4">
      <div className="flex min-w-0 flex-wrap gap-3">
        <label className="text-xs text-gray-600">{view === "range" ? "From" : "Go to date"}<input aria-label={view === "range" ? "Range start" : "Go to date"} type="date" value={anchor} onChange={event => setAnchor(event.target.value)} className="ml-2 min-h-11 max-w-full rounded-lg border px-2 text-sm text-gray-900" /></label>
        {view === "range" && <label className="text-xs text-gray-600">Through<input aria-label="Range end" type="date" value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} className="ml-2 min-h-11 max-w-full rounded-lg border px-2 text-sm text-gray-900" /></label>}
      </div>
      <p className="text-xs text-gray-500">{editable ? (focus === "classes" ? "Select or drag a time to schedule a class activity" : "Select or drag a time to schedule") : "Select scheduled work to view details"} · Drag with a mouse; tap a slot on touch screens · Local time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p>
    </div>
    {draft?.scope === accountScope && editable && <div className="space-y-3 border-b p-4" role="region" aria-label="Choose scheduling type"><p>Choose the type of scheduled work. Your selected start and end times will be kept.</p><div className="flex flex-wrap gap-2">{(["clinical","individual","group"] as const).map(kind => <button type="button" className="rj-button rj-button-secondary" key={kind} onClick={() => openDraft(draft.params,kind)}>{kind === "clinical" ? "ABA session" : kind === "group" ? "Group Activity" : "Individual Activity"}</button>)}<button type="button" onClick={()=>setDraft(null)}>Cancel</button></div></div>}
    {message && <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm text-red-700">{message}{!rangeError && <button className="min-h-11 underline" onClick={refresh}>Try again</button>}</div>}
    {(loading || branch.loading) && <p role="status" className="px-4 py-2 text-sm text-gray-500">{"Loading scheduled work…"}</p>}
    {!message && !loading && !branch.loading && visibleSessions.length === 0 && <p role="status" className="px-4 py-2 text-sm text-gray-500">{"No scheduled work in this view and date range."}{editable ? t(" Select a time slot to schedule one.") : ""}</p>}
    {!rangeError && (agenda ? <div className="max-h-[70dvh] overflow-y-auto">
      {days.map(day => {
        const events = placeEvents(visibleSessions, day)
        return <section key={localDate(day)} className="border-b p-4 last:border-b-0">
          <div className="flex items-center justify-between gap-2"><h2 className="font-bold">{day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h2>{editable && <button aria-label={`Schedule on ${localDate(day)}`} onClick={() => createAt(day, 9 * 60)} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100"><Plus size={18} /></button>}</div>
          {events.length ? <ul className="mt-2 space-y-2">{events.map(({ event }) => <li key={event.id}><Link href={eventHref(event)} className="block rounded-lg border-l-4 border-teal-600 bg-teal-50 p-3 text-sm"><span className="font-bold">{clientName(event)}</span><span className="ml-2">{event.scheduled_start && timeLabel(new Date(event.scheduled_start))} – {event.scheduled_end && timeLabel(new Date(event.scheduled_end))}</span><span className="block">{event.group_activity ? `${event.child_count || 0} children · ` : ""}{event.provider?.full_name || "Assigned team member"} · {scheduleLabel(event)} · {serviceName(event)} · {event.status.replaceAll("_", " ")}</span></Link></li>)}</ul> : <p className="text-sm text-gray-500">{"No scheduled work"}</p>}
        </section>
      })}
    </div> : <div ref={scroller} className="max-h-[70dvh] min-h-[360px] overflow-auto" tabIndex={0} aria-label="Calendar time grid">
      <div className="grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="sticky top-0 z-20 border-b bg-white" />
        {days.map(day => <div key={localDate(day)} className="sticky top-0 z-20 border-b border-l bg-white px-1 py-3 text-center text-xs"><span className="block text-gray-500">{day.toLocaleDateString(undefined, { weekday: "short" })}</span><span className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold ${localDate(day) === localDate(new Date()) ? "bg-teal-700 text-white" : "text-gray-800"}`}>{day.getDate()}</span></div>)}
        <div aria-hidden="true" className="relative bg-gray-50" style={{ height: 24 * hourHeight }}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute right-2 text-[10px] text-gray-500" style={{ top: hour * hourHeight + 4 }}>{timeLabel(new Date(2026, 0, 1, hour)).replace(":00", "")}</span>)}</div>
        {days.map((day, dayIndex) => <div key={localDate(day)} className="relative border-l" style={{ height: 24 * hourHeight }} onPointerDown={event => {
          if (!editable || event.button !== 0 || event.pointerType === "touch" || !(event.target instanceof HTMLElement) || !event.target.closest("button[data-slot]")) return
          const slot = slotAt(event.clientY, event.currentTarget)
          suppressClick.current = false
          event.currentTarget.setPointerCapture(event.pointerId)
          setSelection({ day: dayIndex, first: slot, last: slot })
        }} onPointerMove={event => {
          if (!selection || selection.day !== dayIndex || !event.currentTarget.hasPointerCapture(event.pointerId)) return
          const slot = slotAt(event.clientY, event.currentTarget)
          if (slot !== selection.first) suppressClick.current = true
          setSelection({ ...selection, last: slot })
        }} onPointerUp={event => {
          if (!selection || selection.day !== dayIndex) return
          const last = slotAt(event.clientY, event.currentTarget)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          setSelection(null)
          suppressClick.current = true
          createAt(day, Math.min(selection.first, last) * 30, (Math.max(selection.first, last) + 1) * 30)
        }} onLostPointerCapture={() => setSelection(null)} onPointerCancel={() => { setSelection(null); suppressClick.current = true }} onKeyDown={event => { if (event.key === "Escape") { setSelection(null); suppressClick.current = true } }}>
          {Array.from({ length: 48 }, (_, slot) => {
            const time = new Date(day); time.setHours(Math.floor(slot / 2), (slot % 2) * 30)
            const label = `Schedule work ${day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} ${timeLabel(time)}`
            return <button key={slot} type="button" disabled={!editable} aria-label={label} data-day={dayIndex} data-slot={slot} tabIndex={dayIndex === Math.min(activeSlot.day, days.length - 1) && slot === activeSlot.slot ? 0 : -1} onFocus={() => setActiveSlot({ day: dayIndex, slot })} onKeyDown={event => {
              const delta: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
              if (!delta[event.key]) return
              event.preventDefault()
              const [dayDelta, slotDelta] = delta[event.key]
              const nextDay = Math.max(0, Math.min(days.length - 1, dayIndex + dayDelta))
              const nextSlot = Math.max(0, Math.min(47, slot + slotDelta))
              scroller.current?.querySelector<HTMLButtonElement>(`button[data-day="${nextDay}"][data-slot="${nextSlot}"]`)?.focus()
            }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } createAt(day, slot * 30) }} className={`absolute left-0 w-full border-t text-left focus-visible:z-10 focus-visible:bg-teal-100 focus-visible:outline-2 focus-visible:outline-teal-600 ${slot % 2 ? "border-dashed border-gray-100" : "border-gray-200"} ${editable ? "hover:bg-teal-50" : "cursor-default"}`} style={{ top: slot * hourHeight / 2, height: hourHeight / 2 }} />
          })}
          {selection?.day === dayIndex && <div className="pointer-events-none absolute left-0 z-20 w-full border-2 border-teal-700 bg-teal-200/60" style={{ top: Math.min(selection.first, selection.last) * hourHeight / 2, height: (Math.abs(selection.last - selection.first) + 1) * hourHeight / 2 }} />}
          {placeEvents(visibleSessions, day).map(({ event, start, end, column, columns }) => <Link key={event.id} href={eventHref(event)} aria-label={`${clientName(event)}, ${event.scheduled_start && timeLabel(new Date(event.scheduled_start))}, ${event.status.replaceAll("_", " ")}`} title={`${clientName(event)} · ${event.provider?.full_name || "Assigned team member"} · ${serviceName(event)} · ${event.location || ""} · ${event.status.replaceAll("_", " ")}`} className={`absolute z-10 overflow-hidden rounded-md border-l-[3px] p-1 text-[11px] leading-tight focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-offset-1 ${event.status === "completed" ? "border-green-600 bg-green-100 text-green-950" : terminalStatuses.includes(event.status) ? "border-gray-400 bg-gray-100 text-gray-600" : "border-teal-600 bg-teal-100 text-teal-950"}`} style={{ top: start * hourHeight / 60, height: Math.max(mobile ? 44 : 22, (end - start) * hourHeight / 60 - 2), left: `calc(${column * 100 / columns}% + 2px)`, width: `calc(${100 / columns}% - 4px)` }}>
            <span className="block truncate font-bold">{clientName(event)}</span><span className="block truncate">{scheduleLabel(event)}</span><span className="block truncate">{event.scheduled_start && timeLabel(new Date(event.scheduled_start))}</span><span className="block truncate">{event.provider?.full_name || "Assigned team member"}</span><span className="block truncate">{event.group_activity ? `${event.child_count || 0} children · ` : ""}{serviceName(event)}</span>
          </Link>)}
        </div>)}
      </div>
    </div>)}
  </section>
}
