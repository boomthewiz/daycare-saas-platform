"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

export type SubscriptionAccess = {
  managed: boolean; canWrite: boolean; canFinishSession: boolean; serverNow: string
  trialEndsAt?: string; paidThrough?: string | null; canManageBilling?: boolean; planVersion?: string
}

export function useSubscriptionAccess(sessionId?: string) {
  const [access, setAccess] = useState<SubscriptionAccess | null>(null)
  const [error, setError] = useState("")
  const generation = useRef(0)
  const [loadedSession, setLoadedSession] = useState<string | undefined>(undefined)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const { data, error: failure } = await supabase.rpc("subscription_access", { p_session_id: sessionId || null })
      if (failure || !data || typeof data.canWrite !== "boolean" || typeof data.canFinishSession !== "boolean") throw new Error("Unable to check organization access. Reconnect and try again.")
      if (request !== generation.current) return
      setLoadedSession(sessionId)
      setAccess(data as SubscriptionAccess); setError("")
    } catch {
      if (request !== generation.current) return
      setAccess(null); setError("Unable to check organization access. Reconnect and try again.")
    }
  }, [sessionId])
  useEffect(() => {
    void refresh()
    const check = () => { if (!document.hidden) void refresh() }
    const timer = window.setInterval(check, 60000)
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", check)
    return () => {
      // Invalidate all outstanding requests, including those started after this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      window.clearInterval(timer); window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", check)
    }
  }, [refresh])
  useEffect(() => {
    if (!access?.managed || !access.canWrite) return
    const deadline = Math.max(Date.parse(access.trialEndsAt || "") || 0, Date.parse(access.paidThrough || "") || 0)
    const remaining = deadline - Date.parse(access.serverNow)
    if (!Number.isFinite(remaining)) return
    const timer = window.setTimeout(() => {
      setAccess(null)
      void refresh()
    }, Math.max(0, Math.min(remaining, 2147483647)))
    return () => window.clearTimeout(timer)
  }, [access, refresh])
  return { access: loadedSession === sessionId ? access : null, error, refresh }
}
