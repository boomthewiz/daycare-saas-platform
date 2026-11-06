"use client"
import { useEffect, useRef, useState } from "react"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { supabase } from "@/lib/supabase"
type Access = { userId: string; organizationId: string; clientId: string; read: boolean; edit: boolean }
/** UI affordance only; database policies and triggers enforce every write. */
export function useClinicalProgramAccess(clientId: string) {
 const { data: caps } = useEffectiveCapabilities()
 const scope = caps ? `${caps.userId}:${caps.organizationId}:${clientId}` : ""
 const [access,setAccess] = useState<Access | null>(null)
 const sequence = useRef(0)
 useEffect(() => {
  const counter=sequence
  const refresh = async () => {
   const request = ++counter.current
   if (!scope) { setAccess(null); return }
   try {
    const {data,error} = await supabase.rpc("clinical_program_access",{p_client:clientId})
    if (request !== counter.current) return
    const value = data as Access | null
    if (error || !value || `${value.userId}:${value.organizationId}:${value.clientId}` !== scope || typeof value.read !== "boolean" || typeof value.edit !== "boolean") { setAccess(null); return }
    setAccess(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value)
   } catch { if(request === counter.current) setAccess(null) }
  }
  const reload = () => { if(!document.hidden) void refresh() }
  void refresh()
  const timer = window.setInterval(reload,60000)
  window.addEventListener("focus",reload)
  window.addEventListener("rejoyce:capabilities-changed",reload)
  return () => { counter.current++;clearInterval(timer);window.removeEventListener("focus",reload);window.removeEventListener("rejoyce:capabilities-changed",reload) }
 },[scope,clientId])
 return scope && access && `${access.userId}:${access.organizationId}:${access.clientId}` === scope ? access : null
}
