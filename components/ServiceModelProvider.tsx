"use client"
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { supabase } from "@/lib/supabase"
import type { ServiceModel } from "@/lib/schedule-intent"
export type AccountServiceModel = { organizationId: string; userId: string; model: ServiceModel; version: number; canManage: boolean; canWrite: boolean; updatedBy: string | null; updatedAt: string | null }
const Context = createContext<{ data: AccountServiceModel | null; error: string; refresh: () => Promise<void> }>({ data: null, error: "", refresh: async () => {} })
export default function ServiceModelProvider({ children }: { children: ReactNode }) {
 const { data: caps } = useEffectiveCapabilities()
 const scope = caps ? `${caps.organizationId}:${caps.userId}` : ""
 const [data,setData] = useState<AccountServiceModel | null>(null)
 const [error,setError] = useState("")
 const version = useRef(0)
 const refresh = useCallback(async () => {
  const request = ++version.current
  if (!scope) { setData(null); return }
  try {
   const result = await supabase.rpc("account_service_model")
   if (request !== version.current) return
   const value = result.data as AccountServiceModel
   if (result.error || !value || `${value.organizationId}:${value.userId}` !== scope || !["unconfirmed","daycare","aba","mixed"].includes(value.model) || !Number.isInteger(value.version) || typeof value.canManage !== "boolean" || typeof value.canWrite !== "boolean") throw new Error("Unable to verify business service model. Retry before starting a draft.")
   setData(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); setError("")
  } catch (cause) { if (request === version.current) { setData(null); setError(cause instanceof Error ? cause.message : "Unable to verify service model.") } }
 },[scope])
 useEffect(() => {
  const counter = version
  void refresh()
  const reload = () => { if (!document.hidden) void refresh() }
  const timer = window.setInterval(reload,60000)
  window.addEventListener("focus",reload); window.addEventListener("rejoyce:service-model-changed",reload)
  return () => { counter.current++; clearInterval(timer); window.removeEventListener("focus",reload); window.removeEventListener("rejoyce:service-model-changed",reload) }
 },[refresh])
 const scoped = scope && data && `${data.organizationId}:${data.userId}` === scope ? data : null
 // Invalidate drafts and readers on identity/access changes; routine same-user checks keep this key.
 return <Context.Provider key={scope} value={{data:scoped,error:scope ? error : "",refresh}}>{children}</Context.Provider>
}
export function useServiceModel() { return useContext(Context) }
