"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
export type StaffReadiness = { id: string; invitation: "pending" | "accepted" | "unknown"; account_ready: boolean; ready: boolean; frontline: boolean; branch_assigned: boolean; care_assigned: boolean }
export type SetupProgress = { branch: boolean; session_type: boolean; client: boolean; staff_ready: boolean; care: boolean; scheduled: boolean; can_write: boolean; can_clients: boolean; can_users: boolean; can_sessions: boolean; staff: StaffReadiness[] }
export function useSetupProgress(includeStaff = false) {
  const [data, setData] = useState<SetupProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const version = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++version.current
    setLoading(true); setError(""); setData(null)
    try {
      const result = await supabase.rpc("onboarding_progress", { p_include_staff: includeStaff })
      if (request !== version.current) return
      if (result.error || !result.data || ["branch", "session_type", "client", "staff_ready", "care", "scheduled", "can_write", "can_clients", "can_users", "can_sessions"].some(key => typeof result.data[key] !== "boolean") || !Array.isArray(result.data.staff)) throw new Error("Unable to load setup progress. Your access may have changed. Try again or ask an administrator.")
      setData(result.data as SetupProgress)
    } catch (cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : "Unable to load setup progress.")
    } finally { if (request === version.current) setLoading(false) }
  }, [includeStaff])
  useEffect(() => {
    const reload = () => { if (document.visibilityState === "visible") void refresh() }
    void refresh()
    window.addEventListener("focus", reload)
    window.addEventListener("rejoyce:setup-changed", reload)
    document.addEventListener("visibilitychange", reload)
    // Acceptance may happen on another device; keep the open checklist current.
    const timer = window.setInterval(reload, 30000)
    // Invalidate all outstanding requests, including focus refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { version.current++; clearInterval(timer); window.removeEventListener("focus", reload); window.removeEventListener("rejoyce:setup-changed", reload); document.removeEventListener("visibilitychange", reload) }
  }, [refresh])
  return { data, loading, error, refresh }
}


