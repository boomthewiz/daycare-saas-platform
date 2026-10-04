"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { CareContext, eligibleStaff } from "@/lib/care-team"
import { useBranches } from "@/components/BranchProvider"
import CareTeamPicker from "@/components/CareTeamPicker"
import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"

export default function ClientCareTeam({ clientId, onSaved }: { clientId: string; onSaved?: (primary: string) => void }) {
  const { branches } = useBranches()
  const [context, setContext] = useState<CareContext | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [primary, setPrimary] = useState("")
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    async function load() {
      setLoading(true); setError("")
      try {
        const permission = await supabase.rpc("can_manage_clients")
        if (permission.error) throw new Error(permission.error.message)
        if (live) setAllowed(permission.data === true)
        if (permission.data !== true) return
        const result = await supabase.rpc("care_context", { p_client_id: clientId })
        if (result.error) throw new Error(result.error.message)
        if (live) {
          const data = result.data as CareContext
          setContext(data); setSelected(data.member_ids); setPrimary(data.primary_id || "")
        }
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Unable to load care team.") }
      finally { if (live) setLoading(false) }
    }
    void load()
    return () => { live = false }
  }, [clientId, attempt])
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ clientId: string; locationIds: string[] }>).detail
      if (detail.clientId === clientId) setContext(current => current ? { ...current, location_ids: detail.locationIds } : current)
    }
    window.addEventListener("rejoyce:client-branches-changed", changed)
    return () => window.removeEventListener("rejoyce:client-branches-changed", changed)
  }, [clientId])
  if (!loading && !allowed && !error) return null
  const activeLocations = context?.location_ids.filter(id => branches.some(branch => branch.id === id && branch.active)) || []
  const invalid = selected.some(id => !context?.staff.some(person => person.id === id && eligibleStaff(person, activeLocations)))
  async function save() {
    if (!context || invalid) return
    setSaving(true); setError(""); setMessage("")
    try {
      const result = await supabase.rpc("set_client_care_team", { p_client_id: clientId, p_member_ids: selected, p_primary_id: primary || null, p_expected_version: context.version })
      if (result.error) throw new Error(result.error.message)
      setContext({ ...context, member_ids: selected, primary_id: primary || null, version: result.data })
      setMessage("Care team saved.")
      onSaved?.(primary)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save care team. Your selection is retained.") }
    finally { setSaving(false) }
  }
  return <section className="rj-card space-y-4 p-6 sm:p-8">
    <h2 className="rj-heading-2">Care team</h2>
    {error && <div role="alert" className="text-red-700">{error} Your draft is retained. <button type="button" className="underline" disabled={saving} onClick={() => {
      if (!context || window.confirm("Reload the saved care team? Unsaved assignment changes will be discarded.")) setAttempt(value => value + 1)
    }}>Reload saved assignments</button></div>}
    {message && <p role="status" className="text-green-700">{message}</p>}
    {loading ? <p>Loading care team…</p> : context && <SubscriptionWriteControls>
      <CareTeamPicker context={context} locationIds={activeLocations} selected={selected} primaryId={primary} disabled={saving || !allowed}
        onChange={(ids, primaryId) => { setSelected(ids); setPrimary(primaryId); setMessage("") }} />
      <button type="button" className="rj-button rj-button-primary mt-4" disabled={saving || invalid || !allowed} onClick={() => void save()}>{saving ? "Saving…" : "Save care team"}</button>
    </SubscriptionWriteControls>}
  </section>
}
