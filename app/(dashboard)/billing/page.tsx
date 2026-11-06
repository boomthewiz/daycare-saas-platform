"use client"

import { usePortal } from "@/components/PortalProvider"
import { useSubscriptionAccess } from "@/lib/use-subscription-access"
import { launchPlan } from "@/lib/subscription-plan"

export default function BillingPage() {
  const { t } = usePortal()

 const {access,error,refresh}=useSubscriptionAccess()
 if(error)return <section className="rj-card p-6"><p role="alert">{error}</p><button className="rj-button rj-button-secondary mt-4" onClick={()=>void refresh()}>Try again</button></section>
 if(!access)return <p role="status">Loading subscription…</p>
 if(access.managed&&!access.canManageBilling)return <p role="alert">Billing access is required. Contact your organization owner.</p>
 return <section className="rj-card mx-auto max-w-2xl space-y-5 p-6">
  <h1 className="rj-heading-1">Organization subscription</h1>
  {access.supportGraceExpiresAt && Date.parse(access.supportGraceExpiresAt)>Date.parse(access.serverNow) && <p role="status">Temporary support grace ends {new Date(access.supportGraceExpiresAt).toLocaleString()}. Your original trial and payment history are unchanged.</p>}
  {access.managed ? <><p>Your trial ends {new Date(access.trialEndsAt!).toLocaleString()}.</p><p>{access.canWrite?"Your organization currently has access to its workspace.":t("Your organization has read-only access. Sessions underway when the trial ended may be finished and their notes submitted.")}</p></> : <p>Your organization’s existing access has not changed. No new trial or subscription has been activated.</p>}
  {!!access.billingNotices?.length&&<section aria-label="Support access notices" className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Support access notices</h2><ul className="space-y-2">{access.billingNotices.map(notice=><li key={notice.version}>{new Date(notice.createdAt).toLocaleString()}: {notice.action==="grant"?`Temporary support grace was granted until ${new Date(notice.expiresAt!).toLocaleString()}.`:"Support grace was revoked."} Payment and trial history were unchanged.</li>)}</ul></section>}
  <div className="rounded-xl bg-slate-50 p-5"><p className="text-2xl font-bold">${launchPlan.baseAmountCents/100} USD/month</p><p className="mt-2">Includes one service provider. Additional providers are ${launchPlan.additionalProviderAmountCents/100} each per month. Administrative-only accounts are included.</p><p className="mt-2">{launchPlan.trialDays} days free for new organizations. No card is required until you choose to subscribe.</p></div>
  <p role="status">Subscription checkout is temporarily unavailable. Please try again later. No payment has been taken.</p>
  <button disabled className="rj-button rj-button-primary">Subscribe</button>
 </section>
}
