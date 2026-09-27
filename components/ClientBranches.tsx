"use client"

import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useBranches } from "@/components/BranchProvider"
import ClientBranchPicker from "@/components/ClientBranchPicker"

export default function ClientBranches({ clientId }: { clientId: string }) {
  const { branches, loading: branchLoading, error: branchError, reload } = useBranches()
  const [selected, setSelected] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setReady(false)
      setError(null)
      try {
        const [memberships, permission] = await Promise.all([
          supabase.from("client_locations").select("location_id").eq("client_id", clientId),
          supabase.rpc("can_manage_clients"),
        ])
        if (!mounted) return
        if (memberships.error || permission.error) throw new Error("Unable to load this client's branches. Please retry.")
        setSelected((memberships.data || []).map(row => row.location_id))
        setCanEdit(permission.data === true)
        setReady(true)
      } catch {
        if (mounted) setError("Unable to load this client's branches. Please retry.")
      } finally { if (mounted) setLoading(false) }
    }
    void load()
    return () => { mounted = false }
  }, [clientId, attempt])

  async function save() {
    if (!selected.length) { setError("Choose at least one branch."); return }
    setSaving(true); setError(null); setMessage("")
    try {
      const { error: saveError } = await supabase.rpc("set_client_locations", { p_client_id: clientId, p_location_ids: selected })
      if (saveError) throw saveError
      setMessage("Client branches saved.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save branches. Please retry.") }
    finally { setSaving(false) }
  }

  return <section className="rj-card space-y-4 p-6">
    <h2 className="rj-heading-2">Client branches</h2>
    {(error || branchError) && <div role="alert" className="text-sm text-red-700">
      {error || branchError} <button type="button" className="underline" onClick={() => { setAttempt(value => value + 1); void reload() }}>Retry</button>
    </div>}
    {message && <p role="status" className="text-sm text-teal-800">{message}</p>}
    {loading || branchLoading ? <p>Loading branches…</p> : <>
      <SubscriptionWriteControls><ClientBranchPicker branches={branches} value={selected} disabled={!canEdit || saving || !!branchError}
        onChange={ids => { setSelected(ids); setMessage(""); setError(null) }} /></SubscriptionWriteControls>
      {canEdit && <SubscriptionWriteControls><button type="button" onClick={() => void save()} disabled={saving || !selected.length || !!branchError || !ready}
        className="rj-button rj-button-primary">{saving ? "Saving…" : "Save branches"}</button></SubscriptionWriteControls>}
    </>}
  </section>
}
