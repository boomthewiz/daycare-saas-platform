"use client"

import { usePortal } from "@/components/PortalProvider"
import Link from "next/link"
import { useEffect } from "react"
import { useSubscriptionAccess } from "@/lib/use-subscription-access"

export default function SubscriptionBanner() {
  const { t } = usePortal()

  const { access, error } = useSubscriptionAccess()
  useEffect(() => {
    // Log once when the error changes, rather than on every polling render.
    if (error) console.warn("[ReJoyce subscription access]", error)
  }, [error])
  // This informational banner only renders verified subscription details.
  // Access failures remain available to permission-sensitive screens.
  if (!access?.managed) return null
  const trialActive = !!access.trialEndsAt && Date.parse(access.trialEndsAt) > Date.parse(access.serverNow)
  const graceActive = access.canWrite && !!access.supportGraceExpiresAt && Date.parse(access.supportGraceExpiresAt) > Date.parse(access.serverNow)
    && !(access.paidThrough && Date.parse(access.paidThrough) > Date.parse(access.serverNow)) && !trialActive
  if (access.canWrite && !trialActive && !graceActive) return null
  return <aside className="border-b border-teal-200 bg-teal-50 p-3 text-sm text-teal-950" aria-label="Organization access">
    {graceActive ? <>Temporary support grace enables editing until {new Date(access.supportGraceExpiresAt!).toLocaleString()}. This does not mark an invoice paid.</> : trialActive ? <>Your free trial ends {new Date(access.trialEndsAt!).toLocaleDateString()}. No card is required until you subscribe.</> : <>{t("Your organization has read-only access. Sessions underway when the trial ended may be finished and their notes submitted.")}</>}
    {access.canManageBilling && <> <Link href="/billing" className="font-semibold underline">View subscription</Link></>}
  </aside>
}
