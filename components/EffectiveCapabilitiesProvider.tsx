"use client"
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { normalizeCapabilities, type EffectiveCapabilities } from "@/lib/effective-capabilities"

const Context = createContext<{ data: EffectiveCapabilities | null; loading: boolean; error: string; refresh: () => Promise<void> }>({ data: null, loading: true, error: "", refresh: async () => {} })
export default function EffectiveCapabilitiesProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<EffectiveCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const version = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++version.current
    setData(null); setLoading(true); setError("")
    try {
      const result = await supabase.rpc("effective_capabilities")
      if (request !== version.current) return
      const current = !result.error && normalizeCapabilities(result.data)
      if (!current) throw new Error("Unable to verify access. Unlock your device or retry.")
      setData(current)
    } catch {
      if (request === version.current) setError("Unable to verify access. Unlock your device or retry.")
    } finally { if (request === version.current) setLoading(false) }
  }, [])
  useEffect(() => {
    const counter = version
    const reload = () => { if (!document.hidden) void refresh() }
    const stateChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === "unlocked") reload()
      else { counter.current++; setData(null); setLoading(false) }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      counter.current++; setData(null)
      window.setTimeout(reload, 0)
    })
    reload()
    const timer = window.setInterval(reload, 60000)
    window.addEventListener("focus", reload)
    window.addEventListener("rejoyce:capabilities-changed", reload)
    window.addEventListener("rejoyce:device-state", stateChanged)
    document.addEventListener("visibilitychange", reload)
    return () => { counter.current++; clearInterval(timer); subscription.unsubscribe(); window.removeEventListener("focus", reload); window.removeEventListener("rejoyce:capabilities-changed", reload); window.removeEventListener("rejoyce:device-state", stateChanged); document.removeEventListener("visibilitychange", reload) }
  }, [refresh])
  return <Context.Provider value={{ data, loading, error, refresh }}>{children}</Context.Provider>
}
export function useEffectiveCapabilities() { return useContext(Context) }
