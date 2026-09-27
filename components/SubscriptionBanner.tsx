"use client"
import Link from "next/link"
import { useSubscriptionAccess } from "@/lib/use-subscription-access"

export default function SubscriptionBanner() {
  const { access, error, refresh } = useSubscriptionAccess()
  if (error) return <aside role="status" className="border-b border-amber-200 bg-amber-50 p-3 text-sm">{error} <button className="underline" onClick={() => void refresh()}>Try again</button></aside>
  if (!access?.managed) return null
  const trialActive = !!access.trialEndsAt && Date.parse(access.trialEndsAt) > Date.parse(access.serverNow)
  if (access.canWrite && !trialActive) return null
  return <aside className="border-b border-teal-200 bg-teal-50 p-3 text-sm text-teal-950" aria-label="Organization access">
    {trialActive ? <>Your free trial ends {new Date(access.trialEndsAt!).toLocaleDateString()}. No card is required until you subscribe.</> : <>Your organization has read-only access. Sessions underway when the trial ended may be finished and their notes submitted.</>}
    {access.canManageBilling && <> <Link href="/billing" className="font-semibold underline">View subscription</Link></>}
  </aside>
}
