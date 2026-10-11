"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useSubscriptionAccess } from "@/lib/use-subscription-access"

const WriteAccess = createContext({ allowed: false, checking: true, error: "", refresh: async () => {} })

export function useOrganizationWriteAccess() { return useContext(WriteAccess) }

export function SubscriptionWriteProvider({ children }: { children: ReactNode }) {
  const { access, error, refresh } = useSubscriptionAccess()
  return <WriteAccess.Provider value={{ allowed: access?.canWrite === true, checking: !access && !error, error, refresh }}>
    {children}
  </WriteAccess.Provider>
}

// Apply only to editing controls. Searches, navigation and account recovery stay outside.
// The database remains authoritative, including when a trial expires mid-request.
export default function SubscriptionWriteControls({ children }: { children: ReactNode }) {
  const { allowed } = useContext(WriteAccess)
  return <fieldset disabled={!allowed} aria-disabled={!allowed}
    className="contents [&:disabled>*]:opacity-60"
    title={allowed ? undefined : "Organization editing is unavailable with read-only access."}
    onClickCapture={event => { if (!allowed) { event.preventDefault(); event.stopPropagation() } }}
    onSubmitCapture={event => { if (!allowed) { event.preventDefault(); event.stopPropagation() } }}>
    {children}
  </fieldset>
}
