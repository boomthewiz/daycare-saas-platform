"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"
import { usePortal } from "@/components/PortalProvider"
import { useSetupAccess } from "@/lib/use-setup-access"

export default function SessionPeopleWarning({ missingClients, missingStaff }: { missingClients: boolean; missingStaff: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const shown = useRef(false)
  const access = useSetupAccess()
  const { terms } = usePortal()
  useEffect(() => {
    if (shown.current || access.loading || access.error || !access.sessions || (!missingClients && !missingStaff)) return
    shown.current = true
    const element = dialog.current
    element?.showModal()
  }, [access.loading, access.error, access.sessions, missingClients, missingStaff])
  useEffect(() => {
    const element = dialog.current
    return () => { element?.close(); shown.current = false }
  }, [])
  const missing = [missingClients ? `active ${terms.client_plural.toLowerCase()}` : "", missingStaff ? `active ${terms.frontline_plural.toLowerCase()} eligible to deliver ${terms.session_plural.toLowerCase()}` : ""].filter(Boolean).join(" and ")
  const canFix = (!missingClients || access.clients) && (!missingStaff || access.users)
  return <dialog ref={dialog} aria-labelledby="people-warning-title" aria-describedby="people-warning-description" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border-0 bg-white p-6 shadow-xl backdrop:bg-black/40">
    <h2 id="people-warning-title" className="rj-heading-3">Finish setting up your people</h2>
    <p id="people-warning-description" className="my-4">Your business needs {missing} before you can schedule {terms.session_plural.toLowerCase()}. {canFix ? "Add them in People to get started." : "Ask an administrator to finish this setup in People."}</p>
    <div className="flex flex-wrap justify-end gap-3">
      <button autoFocus className="rj-button rj-button-secondary" onClick={() => dialog.current?.close()}>Later</button>
      {(access.clients || access.users) && <Link className="rj-button rj-button-primary" href="/team-management">Open People</Link>}
    </div>
  </dialog>
}
