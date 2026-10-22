"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { emptyGroup, toggleMember, type ClassContext, type GroupDraft } from "@/lib/activity-groups"
export default function ActivityGroupFields({ value, onChange, disabled, initialClass = "" }: { value: GroupDraft; onChange: (value: GroupDraft) => void; disabled: boolean; initialClass?: string }) {
 const { data: caps } = useEffectiveCapabilities()
 const [context, setContext] = useState<ClassContext | null>(null), [error, setError] = useState("")
 const generation = useRef(0)
 const initialApplied = useRef("")
 useEffect(() => {
  const key = `${context?.organizationId}:${context?.userId}:${initialClass}`
  const item = context?.classes.find(group => group.id === initialClass && group.active)
  if (item && initialApplied.current !== key) {
   initialApplied.current = key
   onChange({ classId: item.id, version: item.version, title: "", children: [...item.child_ids], staff: [...item.staff_ids] })
  }
 }, [context, initialClass, onChange])
 const load = useCallback(async () => {
  const request = ++generation.current; setContext(null); setError("")
  if (!caps?.sessions) return
  const result = await supabase.rpc("activity_class_context")
  if (request !== generation.current) return
  if (result.error || result.data?.organizationId !== caps.organizationId || result.data?.userId !== caps.userId) { setError(result.error?.message || "Class access changed; retry."); return }
  setContext(result.data as ClassContext)
 }, [caps])
 useEffect(() => {
  const counter = generation; void Promise.resolve().then(() => load())
  const device = (event: Event) => { if ((event as CustomEvent<string>).detail === "unlocked") void load(); else { counter.current++; setContext(null) } }
  window.addEventListener("rejoyce:device-state", device)
  return () => { counter.current++; window.removeEventListener("rejoyce:device-state", device) }
 }, [load])
 const selected = context?.classes.find(item => item.id === value.classId)
 return <section className="space-y-3 rounded-xl border p-4" aria-label="Group activity roster">
  <h3 className="font-semibold">Class / reusable activity group</h3>
  <p className="text-sm">Choose a class, then review this activity’s children and staff. Later class changes will not update a saved activity.</p>
  {error && <p role="alert">{error}</p>}
  <button type="button" className="underline" disabled={disabled} onClick={() => void load()}>Reload classes</button> <Link href="/classes" className="underline">Manage classes</Link>
  {!context && !error && <p role="status">Loading classes…</p>}
  <label className="block">Class<select aria-label="Class" className="rj-input" value={value.classId} disabled={disabled || !context} required onChange={event => {
   const item = context?.classes.find(group => group.id === event.target.value)
   onChange(item ? { classId: item.id, version: item.version, title: value.title, children: [...item.child_ids], staff: [...item.staff_ids] } : emptyGroup)
  }}><option value="">Choose a class</option>{context?.classes.filter(item => item.active && context.branches.some(branch => branch.id === item.branch_id && branch.active)).map(item => <option key={item.id} value={item.id}>{item.name} · {context.branches.find(branch => branch.id === item.branch_id)?.name}</option>)}</select></label>
  <label className="block">Activity name<input className="rj-input" value={value.title} maxLength={120} required disabled={disabled} placeholder="For example: Outdoor play" onChange={event => onChange({ ...value, title: event.target.value })} /></label>
  {selected && <>
   {!selected.active && <p role="alert">This class is archived. Choose an active class for a new activity.</p>}
   {selected.version !== value.version && <p role="alert">The class changed. <button type="button" className="underline" disabled={disabled || !selected.active} onClick={() => onChange({ ...value, version: selected.version, children: [...selected.child_ids], staff: [...selected.staff_ids] })}>Use latest class roster</button> before saving.</p>}
   <fieldset disabled={disabled} className="space-y-1"><legend className="font-semibold">Children ({value.children.length})</legend>
    {context?.children.filter(child => child.branch_ids.includes(selected.branch_id) || value.children.includes(child.id)).map(child => <label key={child.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={value.children.includes(child.id)} disabled={!child.active && !value.children.includes(child.id)} onChange={event => onChange({ ...value, children: toggleMember(value.children, child.id, event.target.checked) })} />{child.name}{(!child.active || !child.branch_ids.includes(selected.branch_id)) && " — unavailable; remove before scheduling"}</label>)}
   </fieldset>
   <fieldset disabled={disabled} className="space-y-1"><legend className="font-semibold">Assigned staff ({value.staff.length})</legend>
    {context?.staff.filter(staff => staff.active || value.staff.includes(staff.id)).map(staff => <label key={staff.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={value.staff.includes(staff.id)} onChange={event => onChange({ ...value, staff: toggleMember(value.staff, staff.id, event.target.checked) })} />{staff.name}{!staff.active && " — unavailable; remove before scheduling"}</label>)}
   </fieldset>
  </>}
 </section>
}
