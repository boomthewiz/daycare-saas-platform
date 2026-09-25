"use client"
import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export type SubscriptionAccess = {
  managed: boolean; canWrite: boolean; canFinishSession: boolean; serverNow: string
  trialEndsAt?: string; paidThrough?: string | null; canManageBilling?: boolean; planVersion?: string
}

export function useSubscriptionAccess(sessionId?: string) {
  const [access, setAccess] = useState<SubscriptionAccess | null>(null)
  const [error, setError] = useState("")
  const refresh = useCallback(async () => {
    try {
      const { data, error: failure } = await supabase.rpc("subscription_access", { p_session_id: sessionId || null })
      if (failure || !data || typeof data.canWrite !== "boolean" || typeof data.canFinishSession !== "boolean") throw new Error("Unable to check organization access. Reconnect and try again.")
      setAccess(data as SubscriptionAccess); setError("")
    } catch {
      setAccess(null); setError("Unable to check organization access. Reconnect and try again.")
    }
  }, [sessionId])
  useEffect(() => {
    void refresh()
    const check = () => { if (!document.hidden) void refresh() }
    const timer = window.setInterval(check, 60000)
    window.addEventListener("focus", check)
    return () => { window.clearInterval(timer); window.removeEventListener("focus", check) }
  }, [refresh])
  return { access, error, refresh }
}
