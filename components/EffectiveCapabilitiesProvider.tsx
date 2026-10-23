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
  const verified = useRef<EffectiveCapabilities | null>(null)
  const refresh = useCallback(async () => {
    const request = ++version.current
    // Routine checks keep the verified screen mounted while the RPC is pending.
    setLoading(!verified.current); setError("")
    try {
      const result = await supabase.rpc("effective_capabilities")
      if (request !== version.current) return
      const current = !result.error && normalizeCapabilities(result.data)
      if (!current) throw new Error("Unable to verify access. Unlock your device or retry.")
      verified.current = current
      setData(previous => JSON.stringify(previous) === JSON.stringify(current) ? previous : current)
    } catch {
      if (request === version.current) { verified.current = null; setData(null); setError("Unable to verify access. Unlock your device or retry.") }
    } finally { if (request === version.current) setLoading(false) }
  }, [])
  useEffect(() => {
    const counter = version
    const reload = () => { if (!document.hidden) void refresh() }
    const stateChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === "unlocked") reload()
      else { counter.current++; verified.current = null; setData(null); setLoading(false) }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Token renewal and repeated same-user sign-ins are background rechecks.
      // Sign-out or an identity change must invalidate access immediately.
      if (event === "SIGNED_OUT" || !session || session.user.id !== verified.current?.userId) {
        counter.current++; verified.current = null; setData(null); setLoading(event !== "SIGNED_OUT")
      }
      if (event !== "SIGNED_OUT") window.setTimeout(reload, 0)
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
