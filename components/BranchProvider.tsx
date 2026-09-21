"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Branch, branchStorageKey, validBranchSelection } from "@/lib/branches"

type BranchContextValue = {
  branches: Branch[]
  selectedBranchId: string
  selectBranch: (id: string) => void
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}
const BranchContext = createContext<BranchContextValue | null>(null)

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState("")
  const [storageKey, setStorageKey] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error("Sign in to load your branches.")
      const { data: org, error: orgError } = await supabase.rpc("current_organization_id")
      if (orgError || !org) throw new Error("Unlock your session to load branches.")
      const { data, error: branchError } = await supabase.from("organization_locations")
        .select("id,name,active").eq("organization_id", org).order("sort_order").order("name")
      if (branchError) throw branchError
      const rows = (data || []) as Branch[]
      const key = branchStorageKey(user.id, org)
      let saved: string | null = null
      try { saved = localStorage.getItem(key) } catch { /* Storage may be unavailable. */ }
      setBranches(rows)
      setStorageKey(key)
      setSelectedBranchId(validBranchSelection(saved, rows))
    } catch (cause) {
      setBranches([])
      setStorageKey("")
      setSelectedBranchId("")
      setError(cause instanceof Error ? cause.message : "Unable to load branches. Please try again.")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload, pathname])
  useEffect(() => {
    const refresh = () => { void reload() }
    window.addEventListener("rejoyce:branches-changed", refresh)
    return () => window.removeEventListener("rejoyce:branches-changed", refresh)
  }, [reload])

  function selectBranch(id: string) {
    const selected = validBranchSelection(id, branches)
    setSelectedBranchId(selected)
    try { if (storageKey) localStorage.setItem(storageKey, selected) } catch { /* In-memory selection still works. */ }
  }

  return <BranchContext.Provider value={{ branches, selectedBranchId, selectBranch, loading, error, reload }}>
    {children}
  </BranchContext.Provider>
}

export function useBranches() {
  const value = useContext(BranchContext)
  if (!value) throw new Error("BranchProvider is required")
  return value
}

export function BranchSelector() {
  const { branches, selectedBranchId, selectBranch, loading, error, reload } = useBranches()
  if (error) return <button type="button" onClick={() => void reload()} className="text-sm text-red-700">Retry loading branches</button>
  return <label className="text-xs text-gray-600">
    Client branch
    <select aria-label="Client branch" value={selectedBranchId} disabled={loading}
      onChange={event => selectBranch(event.target.value)}
      className="mt-1 block max-w-52 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
      <option value="">{loading ? "Loading branches…" : "All branches"}</option>
      {branches.filter(branch => branch.active).map(branch =>
        <option key={branch.id} value={branch.id}>{branch.name}</option>)}
    </select>
  </label>
}
