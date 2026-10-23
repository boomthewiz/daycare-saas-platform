"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { toggleMember, type ActivityClass, type ClassContext } from "@/lib/activity-groups"
export default function ClassesPage() {
 const { data: caps } = useEffectiveCapabilities()
 const [context, setContext] = useState<ClassContext | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("")
 const [editing, setEditing] = useState<ActivityClass | null>(null), [name, setName] = useState(""), [branch, setBranch] = useState("")
 const [children, setChildren] = useState<string[]>([]), [staff, setStaff] = useState<string[]>([]), [active, setActive] = useState(true), [busy, setBusy] = useState(false), [search, setSearch] = useState("")
 const generation = useRef(0)
 const load = useCallback(async () => {
  const request = ++generation.current; setContext(null); setError(""); setBusy(false)
  if (!caps) return
  const result = await supabase.rpc("activity_class_context")
  if (request !== generation.current) return
  if (result.error || result.data?.organizationId !== caps.organizationId || result.data?.userId !== caps.userId) { setError(result.error?.message || "Class access changed; retry."); return }
  setContext(result.data as ClassContext)
 }, [caps])
 useEffect(() => {
  const counter = generation; setEditing(null); setName(""); setChildren([]); setStaff([]); setNotice(""); void load()
  const device = (event: Event) => { if ((event as CustomEvent<string>).detail === "unlocked") void load(); else { counter.current++; setContext(null); setChildren([]); setStaff([]); setName(""); setEditing(null); setNotice(""); setBusy(false) } }
  window.addEventListener("rejoyce:device-state", device)
  return () => { counter.current++; window.removeEventListener("rejoyce:device-state", device) }
 }, [load])
 const edit = (item: ActivityClass | null) => { setEditing(item); setName(item?.name || ""); setBranch(item?.branch_id || ""); setChildren(item?.child_ids || []); setStaff(item?.staff_ids || []); setActive(item?.active ?? true); setError(""); setNotice("") }
 return <div className="mx-auto max-w-5xl space-y-5">
  <h1 className="rj-heading-1">Classes</h1>
  <p>Build reusable child rosters and suggested staff for group activities. Classes organize scheduling; attendance is recorded separately.</p>
  {caps?.sessions && <Link href="/sessions?group=1" className="rj-button rj-button-primary mr-3">Schedule group activity</Link>}
  {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  <button className="underline" disabled={busy} onClick={() => { if (!editing || window.confirm("Reload classes? Unsaved edits will be cleared.")) { edit(null); void load() } }}>Reload classes</button>
  {!context && !error && <p role="status">Checking class access…</p>}
  {context && <div className="grid min-w-0 gap-6 lg:grid-cols-2"><section className="rj-card min-w-0 space-y-4 p-5">
   <h2 className="rj-heading-2">Reusable groups</h2>
   <label className="block">Find a class<input className="rj-input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search classes" /></label>
   {context.classes.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => <article key={item.id} className="min-w-0 space-y-2 break-words rounded-xl border p-4">
    <h3 className="font-semibold">{item.name}{!item.active && " · Archived"}</h3><p>{context.branches.find(location => location.id === item.branch_id)?.name} · {item.child_ids.length} {item.child_ids.length === 1 ? "child" : "children"} · {item.staff_ids.length} suggested staff</p>
    <div className="flex flex-wrap gap-3">{context.canEdit && <button className="underline" disabled={busy} onClick={() => edit(item)}>Edit {item.name}</button>}{item.active && caps?.sessions && <Link className="underline" href={`/sessions?group=1&class=${item.id}`}>Schedule activity for {item.name}</Link>}</div>
   </article>)}
   {!context.classes.length && <p>No classes yet. Create a class to reuse its roster when scheduling.</p>}
  </section>{context.canEdit && <form className="rj-card min-w-0 space-y-4 p-5" onSubmit={async event => {
   event.preventDefault(); const request = ++generation.current; setBusy(true); setError(""); setNotice("")
   try {
    const result = await supabase.rpc("save_activity_class", { p_id: editing?.id || null, p_version: editing?.version || null, p_name: name, p_branch: branch, p_children: children, p_staff: staff, p_active: active })
    if (request !== generation.current) return
    if (result.error) throw new Error(result.error.message)
    edit(null); await load(); setNotice("Class saved. Existing activities keep their reviewed rosters.")
   } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "Unable to save class.") }
   finally { if (request === generation.current) setBusy(false) }
  }}><h2 className="rj-heading-2">{editing ? "Edit class" : "Create class"}</h2>
   {!context.canWrite && <p>Read-only access: class changes are unavailable.</p>}
   <fieldset disabled={busy || !context.canWrite} className="space-y-4">
    <label className="block">Class name<input className="rj-input" required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="For example: Preschool Blue" /></label>
    <label className="block">Branch<select aria-label="Branch" className="rj-input" required value={branch} onChange={event => { setBranch(event.target.value); setChildren([]) }}><option value="">Choose branch</option>{context.branches.filter(item => item.active || item.id === branch).map(item => <option key={item.id} value={item.id}>{item.name}{!item.active && " (inactive)"}</option>)}</select></label>
    <label className="flex min-h-11 min-w-0 items-center gap-3 break-all"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Available for new activities</label>
    <fieldset><legend className="font-semibold">Child roster ({children.length})</legend>{context.children.filter(child => child.branch_ids.includes(branch) || children.includes(child.id)).map(child => <label key={child.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={children.includes(child.id)} disabled={!child.active && !children.includes(child.id)} onChange={event => setChildren(toggleMember(children, child.id, event.target.checked))} />{child.name}{!child.active && " (inactive)"}</label>)}{!branch && <p>Choose a branch to see its children.</p>}</fieldset>
    <fieldset><legend className="font-semibold">Suggested staff ({staff.length})</legend>{context.staff.filter(person => person.active || staff.includes(person.id)).map(person => <label key={person.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={staff.includes(person.id)} onChange={event => setStaff(toggleMember(staff, person.id, event.target.checked))} />{person.name}{!person.active && " (unavailable — remove from active roster)"}</label>)}</fieldset>
    <button className="rj-button rj-button-primary" type="submit">{busy ? "Saving…" : "Save class"}</button> <button className="underline" type="button" onClick={() => edit(null)}>New class / clear form</button>
   </fieldset>
  </form>}</div>}
 </div>
}
