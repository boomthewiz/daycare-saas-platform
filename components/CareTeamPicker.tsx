"use client"

import { usePortal } from "@/components/PortalProvider"

import Link from "next/link"
import { CareContext, CareStaff, eligibleStaff, groupSelection, selectPeople } from "@/lib/care-team"

export default function CareTeamPicker({ context, locationIds, selected, primaryId, onChange, disabled = false }: {
  context: CareContext; locationIds: string[]; selected: string[]; primaryId: string
  onChange: (ids: string[], primary: string) => void; disabled?: boolean
}) {
  const { t } = usePortal()

  const eligible = context.staff.filter(person => eligibleStaff(person, locationIds))
  const unique = [...new Set(selected)]
  const unavailable = unique.filter(id => !eligible.some(person => person.id === id))
  const groups = context.groups.filter(group => locationIds.includes(group.location_id))
  function change(ids: string[], checked: boolean) {
    const next = selectPeople(unique, ids, checked)
    onChange(next, next.includes(primaryId) ? primaryId : "")
  }
  function row(person: CareStaff) {
    const canSelect = eligible.some(member => member.id === person.id)
    return <label key={person.id} className="flex min-h-11 items-center gap-3 rounded-lg p-3 hover:bg-gray-50">
      <input type="checkbox" checked={unique.includes(person.id)} disabled={disabled || (!canSelect && !unique.includes(person.id))}
        onChange={event => change([person.id], event.target.checked)} />
      <span>{person.name}{!canSelect && <span className="ml-2 text-sm text-red-700">Unavailable — remove or update setup</span>}</span>
    </label>
  }
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-gray-200 p-4">
    <legend className="px-1 font-semibold">Care-team assignments</legend>
    <p className="rj-caption">{t("Select current members. Future group changes do not update this client’s saved care team.")}</p>
    <p className="rj-caption">A person counts once across groups. Deselecting them removes them everywhere; selecting a whole group again adds its current eligible members.</p>
    {!locationIds.length && <p>{t("Choose client branches first.")}</p>}
    {groups.map(group => {
      const people = eligible.filter(person => group.member_ids.includes(person.id) && person.location_ids.includes(group.location_id))
      const ids = people.map(person => person.id)
      const state = groupSelection(ids, unique)
      return <div key={group.id} className="rounded-lg border border-gray-200 p-3">
        <label className="flex min-h-11 items-center gap-3 font-medium">
          <input type="checkbox" checked={state.all} aria-checked={state.partial ? "mixed" : state.all}
            ref={node => { if (node) node.indeterminate = state.partial }} disabled={disabled || !ids.length}
            onChange={event => change(ids, event.target.checked)} />
          <span>{group.name} <span className="text-sm font-normal">({group.kind}) — {state.count}/{state.total} selected{state.partial ? " · Partially selected" : ""}</span></span>
        </label>
        <details className="mt-2"><summary className="min-h-11 cursor-pointer py-2">Show members of {group.name}</summary>
          {people.map(row)}
          {!people.length && <p className="rj-caption p-3">No eligible members. Set up active staff for this group’s branch.</p>}
        </details>
      </div>
    })}
    <details open><summary className="cursor-pointer py-2 font-medium">Select individuals</summary>
      {eligible.map(row)}
      {!eligible.length && <p className="rj-caption">No eligible staff for these branches. <Link href="/setup/care-teams" className="underline">Set up staff branches and groups</Link>.</p>}
    </details>
    {!!unavailable.length && <div role="alert" className="text-red-700">
      <p>Some selected people are unavailable for these branches. Remove them or update setup before saving.</p>
      {unavailable.map(id => row(context.staff.find(person => person.id === id) || { id, name: "Unavailable staff", role: "", status: "inactive", location_ids: [] }))}
    </div>}
    <label className="block space-y-2"><span className="font-medium">Default scheduling worker</span>
      <select className="rj-input" value={primaryId} onChange={event => onChange(unique, event.target.value)}>
        <option value="">No default worker</option>
        {context.staff.filter(person => unique.includes(person.id)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
      <span className="rj-caption block">{t("Choose from the selected care team. Individual sessions may use another worker.")}</span>
    </label>
    <div aria-live="polite" className="rounded-lg bg-blue-50 p-4">
      <p className="font-semibold">Assignment summary — {unique.length} {unique.length === 1 ? "person" : "people"}</p>
      <p>{unique.length ? unique.map(id => context.staff.find(person => person.id === id)?.name || "Unavailable staff").join(", ") : t("No care-team members selected.")}</p>
      <p className="mt-2 text-sm">Default worker: {context.staff.find(person => person.id === primaryId)?.name || "None"}</p>
      {groups.map(group => {
        const state = groupSelection(eligible.filter(person => group.member_ids.includes(person.id) && person.location_ids.includes(group.location_id)).map(person => person.id), unique)
        return state.count > 0 ? <p key={group.id} className="text-sm">{group.name}: {state.count}/{state.total}{state.partial ? " — partially selected" : " — all eligible members selected"}</p> : null
      })}
      <p className="mt-2 text-sm">{t("Selected staff may view this client’s profile, targets, and behaviors while branch eligibility is valid. Session and note access follow existing permissions.")}</p>
    </div>
  </fieldset>
}
