"use client"

import { Info } from "lucide-react"
import { useOrganizationWriteAccess } from "@/components/SubscriptionWriteControls"

export default function AccessHelp() {
  const { allowed, checking, error, refresh } = useOrganizationWriteAccess()
  const explanation = "Options on this page depend on your account permissions. If an option is missing, ask your account's primary administrator to review your access."
  return <details className="relative ml-auto w-fit text-sm">
    <summary title={explanation} className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2"><Info size={16} aria-hidden="true" />Access info</summary>
    <div className="absolute right-0 top-full z-40 w-[min(20rem,calc(100vw-3rem))] rounded-xl border bg-white p-4 shadow-lg">
      <p>{explanation}</p>
      {checking ? <p className="mt-2 text-gray-500">Checking editing access…</p> : error ? <p role="alert" className="mt-2 text-red-700">{error} <button type="button" onClick={() => void refresh()} className="min-h-11 underline">Try again</button></p> : !allowed ? <p className="mt-2 text-gray-600">Organization editing is also restricted by the current subscription. Ask your primary administrator to review the account&apos;s subscription.</p> : null}
    </div>
  </details>
}
