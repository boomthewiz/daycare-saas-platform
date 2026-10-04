"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { CareContext, CareGroup, careRoles, selectPeople } from "@/lib/care-team"
import { useBranches } from "@/components/BranchProvider"
import ClientBranchPicker from "@/components/ClientBranchPicker"
import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"

export default function CareSetupPage() {
  const { branches, loading: branchLoading, error: branchError } = useBranches()
  const [context, setContext] = useState<CareContext | null>(null)
  const [permission, setPermission] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [staffId, setStaffId] = useState("")
  const [staffBranches, setStaffBranches] = useState<string[]>([])
  const [editing, setEditing] = useState<CareGroup | null>(null)
  const [name, setName] = useState("")
  const [kind, setKind] = useState("team")
  const [locationId, setLocationId] = useState("")
  const [members, setMembers] = useState<string[]>([])
  useEffect(() => {
    let live = true
    async function load() {
      setLoading(true); setError("")
      try {
        const allowed = await supabase.rpc("can_manage_clients")
        if (allowed.error) throw new Error(allowed.error.message)
        if (live) setPermission(allowed.data === true)
        if (allowed.data !== true) return
        const result = await supabase.rpc("care_context", { p_client_id: null })
        if (result.error) throw new Error(result.error.message)
        if (live) setContext(result.data as CareContext)
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Unable to load setup.") }
      finally { if (live) setLoading(false) }
    }
    void load()
    return () => { live = false }
  }, [attempt])
  const staff = context?.staff.filter(person => person.status === "active" && careRoles.includes(person.role)) || []
  const groupStaff = staff.filter(person => person.location_ids.includes(locationId))
  const invalidGroupMembers = members.some(id => !groupStaff.some(person => person.id === id))
  function edit(group: CareGroup | null) {
    setEditing(group); setName(group?.name || ""); setKind(group?.kind || "team"); setLocationId(group?.location_id || ""); setMembers(group?.member_ids || [])
  }
  async function refresh() {
    const result = await supabase.rpc("care_context", { p_client_id: null })
    if (result.error) throw new Error("Saved, but setup could not be refreshed. Reload before editing again.")
    setContext(result.data as CareContext)
  }
  async function saveStaff() {
    if (!context || !staffId) return
    const removed = context.staff.find(person => person.id === staffId)?.location_ids.some(id => !staffBranches.includes(id))
    if (!removed || window.confirm("Save staff branches? Removing a shared branch can remove care-team access. Existing session and management permissions remain in effect.")) {
      setSaving(true); setError(""); setMessage("")
      try {
        const result = await supabase.rpc("save_staff_locations", { p_user_id: staffId, p_location_ids: staffBranches, p_expected_ids: context.staff.find(person => person.id === staffId)?.location_ids || [] })
        if (result.error) throw new Error(result.error.message)
        await refresh(); setMessage("Staff branches saved.")
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save staff branches.") }
      finally { setSaving(false) }
    }
  }
  async function saveGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!context || invalidGroupMembers) return
    setSaving(true); setError(""); setMessage("")
    try {
      const result = await supabase.rpc("save_care_group", { p_id: editing?.id || null, p_name: name, p_kind: kind, p_location_id: locationId, p_member_ids: members, p_expected_version: editing?.version ?? null })
      if (result.error) throw new Error(result.error.message)
      edit(null); await refresh(); setMessage("Group saved. Existing client care teams are unchanged.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save the group.") }
    finally { setSaving(false) }
  }
  return <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
    <Link href="/team-management" className="underline">Back to clients and team</Link>
    <h1 className="rj-heading-1">Care-team setup</h1>
    <p>Set staff branches first, then organize teams, classes, or groups. Groups are selection shortcuts; adding a member does not grant access to any client.</p>
    {error && <p role="alert" className="text-red-700">{error} <button type="button" disabled={saving} className="underline" onClick={() => {
      if (window.confirm("Reload setup? Unsaved setup changes will be discarded.")) { setStaffId(""); setStaffBranches([]); edit(null); setAttempt(value => value + 1) }
    }}>Reload setup</button></p>}
    {branchError && <p role="alert" className="text-red-700">{branchError}</p>}
    {message && <p role="status" className="text-green-700">{message}</p>}
    {loading || branchLoading ? <p>Loading setup…</p> : !permission ? <p>You need Manage clients permission to use care-team setup.</p> : context && <SubscriptionWriteControls>
      <fieldset disabled={saving || !!branchError} className="rj-card space-y-4 p-5">
        <legend className="px-2 font-semibold">1. Staff branches</legend>
        <label className="block"><span>Staff member</span><select aria-label="Staff member" className="rj-input mt-2" value={staffId} onChange={event => {
          const id = event.target.value; setStaffId(id); setStaffBranches(staff.find(person => person.id === id)?.location_ids || [])
        }}><option value="">Choose active staff</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        {staffId && <ClientBranchPicker branches={branches} value={staffBranches} onChange={setStaffBranches} disabled={saving} description="Choose branches where this staff member may serve assigned clients." />}
        <p className="rj-caption">Staff may be selected for clients sharing an active branch. Removing all shared branches stops access granted by a care-team assignment; other existing access may remain.</p>
        <button type="button" disabled={!staffId || saving} className="rj-button rj-button-primary" onClick={() => void saveStaff()}>{saving ? "Saving…" : "Save staff branches"}</button>
      </fieldset>
      <section className="rj-card mt-6 space-y-4 p-5">
        <h2 className="rj-heading-2">2. Teams, classes, and groups</h2>
        <div className="flex flex-wrap gap-2"><button type="button" className="rj-button rj-button-secondary" disabled={saving} onClick={() => edit(null)}>New group</button>
          {context.groups.map(group => <button key={group.id} type="button" disabled={saving} className="rj-button rj-button-secondary" onClick={() => edit(group)}>Edit {group.name}</button>)}
        </div>
        <form onSubmit={event => void saveGroup(event)}>
          <fieldset disabled={saving || !!branchError} className="space-y-4">
            <legend className="font-medium">{editing ? `Edit ${editing.name}` : "Create a group"}</legend>
            <label className="block">Name<input className="rj-input mt-2" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
            <label className="block">Type<select className="rj-input mt-2" value={kind} onChange={event => setKind(event.target.value)}><option value="team">Team</option><option value="class">Class</option><option value="group">Group</option></select></label>
            <label className="block">Group branch<select className="rj-input mt-2" required value={locationId} onChange={event => { setLocationId(event.target.value); setMembers([]) }}>
              <option value="">Choose a branch</option>{branches.filter(branch => branch.active).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select></label>
            <fieldset className="rounded-lg border border-gray-200 p-3"><legend>Current members</legend>
              {groupStaff.map(person => <label key={person.id} className="flex items-center gap-3 p-3"><input type="checkbox" checked={members.includes(person.id)} onChange={event => setMembers(selectPeople(members, [person.id], event.target.checked))} />{person.name}</label>)}
              {!groupStaff.length && <p className="rj-caption">Set up active staff for this branch first.</p>}
              {invalidGroupMembers && <div role="alert" className="text-red-700"><p>Some saved members are no longer eligible. Remove them before saving.</p>
                {members.filter(id => !groupStaff.some(person => person.id === id)).map(id => <label key={id} className="flex gap-3 p-3"><input type="checkbox" checked onChange={() => setMembers(members.filter(memberId => memberId !== id))} />{context.staff.find(person => person.id === id)?.name || "Unavailable staff"}</label>)}
              </div>}
            </fieldset>
            <p className="rj-caption">{new Set(members).size} members selected. People can belong to multiple groups. Changes here do not change saved client assignments.</p>
            <button type="submit" disabled={saving || !locationId || !name.trim() || invalidGroupMembers} className="rj-button rj-button-primary">{saving ? "Saving…" : "Save group"}</button>
          </fieldset>
        </form>
      </section>
    </SubscriptionWriteControls>}
  </main>
}
