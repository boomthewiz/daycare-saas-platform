"use client"
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { supabase } from "@/lib/supabase"

export type SchedulingTimezone = { organizationId: string; userId: string; timezone: string | null; version: number; canManage: boolean; canWrite: boolean; updatedBy: string | null; updatedAt: string | null }
const Context = createContext<{ data: SchedulingTimezone | null; error: string; refresh: () => Promise<void> }>({ data: null, error: "", refresh: async () => {} })
export default function SchedulingTimezoneProvider({ children }: { children: ReactNode }) {
 const { data: caps } = useEffectiveCapabilities()
 const scope = caps ? `${caps.organizationId}:${caps.userId}` : ""
 const [data,setData] = useState<SchedulingTimezone | null>(null)
 const [error,setError] = useState("")
 const version = useRef(0)
 const refresh = useCallback(async () => {
  const request = ++version.current
  if (!scope) { setData(null); return }
  try {
   const result = await supabase.rpc("scheduling_timezone")
   if (request !== version.current) return
   const value = result.data as SchedulingTimezone
   if (result.error || !value || `${value.organizationId}:${value.userId}` !== scope || !(value.timezone === null || typeof value.timezone === "string") || !Number.isInteger(value.version) || typeof value.canManage !== "boolean" || typeof value.canWrite !== "boolean") throw new Error("Unable to verify scheduling timezone. Retry before starting a draft.")
   setData(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); setError("")
  } catch (cause) { if (request === version.current) { setData(null); setError(cause instanceof Error ? cause.message : "Unable to verify scheduling timezone.") } }
 },[scope])
 useEffect(() => {
  const counter = version
  void refresh()
  const reload = () => { if (!document.hidden) void refresh() }
  const timer = window.setInterval(reload,60000)
  window.addEventListener("focus",reload); window.addEventListener("rejoyce:scheduling-timezone-changed",reload)
  return () => { counter.current++; clearInterval(timer); window.removeEventListener("focus",reload); window.removeEventListener("rejoyce:scheduling-timezone-changed",reload) }
 },[refresh])
 const scoped = scope && data && `${data.organizationId}:${data.userId}` === scope ? data : null
 // Invalidate drafts and readers on identity/access changes; routine same-user checks keep this key.
 return <Context.Provider key={scope} value={{data:scoped,error:scope ? error : "",refresh}}>{children}</Context.Provider>
}
export function useSchedulingTimezone() { return useContext(Context) }
/** Freeze the interpretation of open drafts. A remote setting change requires an explicit reload. */
export function useScheduleClock() {
 const {data,error}=useSchedulingTimezone()
 const [clock,setClock]=useState<SchedulingTimezone|null>(null)
 if(data&&!clock)setClock(data)
 const valid=!!data&&!!clock?.timezone&&data.version===clock.version&&data.timezone===clock.timezone
 return {clock,timezone:clock?.timezone||"",valid,error:error||(!data?"Checking scheduling timezone…":!clock?.timezone?"Confirm the organization scheduling timezone in Setup.":!valid?"Scheduling timezone changed. Reload this page and review times before saving.":"")}
}
