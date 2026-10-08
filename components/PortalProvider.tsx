"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { defaultTerms, normalizeTerms, themes, translatePortalText, type PortalTerms, type PortalTheme } from "@/lib/portal-presets"

const PortalContext = createContext({ terms: defaultTerms, theme: "rejoyce" as PortalTheme, refresh: async () => {} })
export default function PortalProvider({ children }: { children: ReactNode }) {
  const [terms, setTerms] = useState<PortalTerms>(defaultTerms)
  const [theme, setTheme] = useState<PortalTheme>("rejoyce")
  const requests = useRef({ version: 0 })
  const refresh = useCallback(async () => {
    const request = ++requests.current.version
    try {
      const { data: org, error: orgError } = await supabase.rpc("current_organization_id")
      if (request !== requests.current.version) return
      if (orgError || !org) { setTerms(defaultTerms); setTheme("rejoyce"); return }
      const { data, error } = await supabase.from("organization_terminology").select("*").eq("organization_id", org).maybeSingle()
      if (error || request !== requests.current.version) return
      setTerms(normalizeTerms(data))
      setTheme(themes.some(option => option.id === data?.portal_theme) ? data.portal_theme : "rejoyce")
    } catch { /* Keep the last verified presentation on a connection interruption. */ }
  }, [])
  useEffect(() => {
    const counter = requests.current
    const reload = () => { void refresh() }
    reload()
    window.addEventListener("rejoyce:terminology-changed", reload)
    return () => { counter.version++; window.removeEventListener("rejoyce:terminology-changed", reload) }
  }, [refresh])
  return <PortalContext.Provider value={{ terms, theme, refresh }}><div className="rj-portal min-h-screen" data-portal-theme={theme}>{children}</div></PortalContext.Provider>
}
export function usePortal() {
  const portal = useContext(PortalContext)
  return { ...portal, t: (text: string) => translatePortalText(text, portal.terms) }
}
