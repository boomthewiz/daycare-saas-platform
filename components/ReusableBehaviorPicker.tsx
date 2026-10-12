"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { behaviorKey, reusableBehaviors, type ReusableBehavior } from "@/lib/client-program-options"
import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"

export default function ReusableBehaviorPicker({ clientId, organizationId, assigned, onApplied }: {
  clientId: string
  organizationId: string
  assigned: ReusableBehavior[]
  onApplied: () => Promise<void>
}) {
  const [options, setOptions] = useState<ReusableBehavior[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    async function load() {
      setLoading(true); setError(""); setAllowed(false); setOptions([]); setSelectedId("")
      try {
        const permission = await supabase.rpc("can_manage_clients")
        if (permission.error) throw new Error(permission.error.message)
        if (permission.data !== true) return
        const result = await supabase.from("client_behaviors")
          .select("id,organization_id,client_id,name,description,measurement_type,active")
          .eq("organization_id", organizationId)
          .order("updated_at", { ascending: false })
        if (result.error) throw new Error(result.error.message)
        if (live) {
          setOptions(reusableBehaviors(result.data || [], organizationId, clientId))
          setAllowed(true)
        }
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Unable to load existing behaviors.") }
      finally { if (live) setLoading(false) }
    }
    void load()
    return () => { live = false }
  }, [clientId, organizationId, attempt])

  const selected = options.find(option => option.id === selectedId)
  const existing = selected && assigned.find(row => behaviorKey(row) === behaviorKey(selected) && row.active)

  async function apply() {
    if (!selected || !allowed || existing || saving) return
    setSaving(true); setError(""); setMessage("")
    try {
      const result = await supabase.rpc("apply_client_behavior", {
        p_client_id: clientId, p_source_behavior_id: selected.id,
      })
      if (result.error) throw new Error(result.error.message)
      setSelectedId("")
      setMessage("Behavior applied to this client. It is available in sessions.")
      await onApplied()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to apply this behavior. Try again.") }
    finally { setSaving(false) }
  }

  if (!loading && !allowed && !error) return null
  return <div className="space-y-3 border-b border-[var(--rj-border)] p-6">
    {error && <p role="alert">{error} <button type="button" className="underline" disabled={saving} onClick={() => setAttempt(value => value + 1)}>Reload behaviors</button></p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p className="rj-caption">Loading existing behaviors…</p> : allowed && <SubscriptionWriteControls>
      <label htmlFor="reusable-behavior" className="rj-label">Select an existing behavior</label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <select id="reusable-behavior" className="rj-input" value={selectedId} disabled={saving} onChange={event => { setSelectedId(event.target.value); setMessage("") }}>
          <option value="">{options.length ? "Choose a behavior…" : "No existing behaviors yet"}</option>
          {options.map(option => {
            const added = assigned.some(row => row.active && behaviorKey(row) === behaviorKey(option))
            return <option key={option.id} value={option.id} disabled={added}>{option.name} ({option.measurement_type}){added ? " — already added" : ""}</option>
          })}
        </select>
        <button type="button" className="rj-button rj-button-secondary" disabled={!selected || !!existing || saving} onClick={() => void apply()}>{saving ? "Applying…" : "Apply Behavior"}</button>
      </div>
      {selected?.description && <p className="rj-caption mt-2">{selected.description}</p>}
    </SubscriptionWriteControls>}
  </div>
}
