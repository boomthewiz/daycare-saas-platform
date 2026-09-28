"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

type Billing = {
  managed: boolean; enabled?: boolean; status?: string; providers?: number; monthlyAmount?: number
  billedSeats?: number; scheduledSeats?: number | null; trialEndsAt?: string; paidThrough?: string | null
  cancelAt?: string | null; subscribed?: boolean; needsAttention?: boolean
}
async function billingRequest(path: string, action?: string) {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error("Sign in and unlock your session to manage billing.")
  const response = await fetch(path, { method: action ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    ...(action ? { body: JSON.stringify({ action }) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "Billing is unavailable. Try again.")
  return result
}
export default function BillingPage() {
  const [billing, setBilling] = useState<Billing | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const result = await billingRequest("/api/billing")
      if (current === generation.current) { setBilling(result); setError("") }
    } catch (failure) {
      if (current === generation.current) { setBilling(null); setError(failure instanceof Error ? failure.message : "Billing unavailable.") }
    }
  }, [])
  useEffect(() => {
    void refresh()
    const check = () => { if (!document.hidden) void refresh() }
    const timer = window.setInterval(check, 15000)
    window.addEventListener("focus", check)
    return () => {
      // Invalidate any request started since the effect was mounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      window.clearInterval(timer); window.removeEventListener("focus", check)
    }
  }, [refresh])
  async function act(action: string) {
    setBusy(true); setError("")
    try {
      const result = await billingRequest(action === "subscribe" ? "/api/create-subscription" : "/api/billing", action)
      if (result.url) { window.location.assign(result.url); return }
      setConfirmCancel(false)
      await refresh()
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Billing unavailable.") }
    finally { setBusy(false) }
  }
  return <section className="rj-card mx-auto max-w-2xl space-y-5 p-6">
    <h1 className="rj-heading-1">Organization subscription</h1>
    {error && <p role="alert">{error}</p>}
    {!billing && !error && <p role="status">Loading subscription…</p>}
    {!billing && error && <button className="rj-button rj-button-secondary" onClick={() => void refresh()}>Try again</button>}
    {billing && !billing.managed && <p>Your organization’s existing access has not changed. No trial or paid subscription has been activated.</p>}
    {billing?.managed && <>
      <div className="rounded-xl bg-slate-50 p-5">
        <p className="text-2xl font-bold">${(billing.monthlyAmount! / 100).toFixed(2)} USD/month</p>
        <p className="mt-2">{billing.providers} active service providers. $79 includes one provider; each additional provider is $29/month. Administrative-only accounts are included.</p>
      </div>
      <p>Trial ends {new Date(billing.trialEndsAt!).toLocaleString()}. Subscribing preserves this deadline.</p>
      <p>Status: {billing.status?.replaceAll("_", " ")}</p>
      {billing.paidThrough && <p>Paid access through {new Date(billing.paidThrough).toLocaleString()}.</p>}
      {billing.cancelAt && <p>Cancellation scheduled for {new Date(billing.cancelAt).toLocaleString()}.</p>}
      {billing.scheduledSeats != null && <p>{billing.scheduledSeats} provider seats scheduled for the next renewal.</p>}
      <p>Added providers are prorated immediately. Reductions apply at renewal. If a payment fails, access lasts through the existing paid or trial deadline, then records remain readable.</p>
      {billing.needsAttention && <p role="status">A billing update is pending. Please refresh shortly.</p>}
      {!billing.enabled ? <p role="status">Subscription checkout is temporarily unavailable. No payment has been taken.</p> : <>
        <p className="rounded-xl bg-amber-50 p-3">Test billing only. Use a Stripe test payment method.</p>
        <div className="flex flex-wrap gap-3">
          {(!billing.subscribed || ["canceled", "incomplete_expired"].includes(billing.status!)) && <button disabled={busy} className="rj-button rj-button-primary" onClick={() => void act("subscribe")}>Subscribe</button>}
          {billing.subscribed && <button disabled={busy} className="rj-button rj-button-secondary" onClick={() => void act("portal")}>Manage payment method and invoices</button>}
          <button disabled={busy} className="rj-button rj-button-secondary" onClick={() => void act("refresh")}>Refresh billing</button>
          {billing.subscribed && !billing.cancelAt && !["canceled", "incomplete_expired"].includes(billing.status!) && <button disabled={busy} className="rj-button rj-button-secondary" onClick={() => setConfirmCancel(true)}>Cancel subscription</button>}
        </div>
        {confirmCancel && <div className="rounded-xl border p-4"><p>Cancel at the end of the current billing period? Your existing paid access remains available until then.</p><div className="mt-3 flex gap-3"><button disabled={busy} className="rj-button rj-button-primary" onClick={() => void act("cancel")}>Confirm cancellation</button><button disabled={busy} className="rj-button rj-button-secondary" onClick={() => setConfirmCancel(false)}>Keep subscription</button></div></div>}
      </>}
    </>}
  </section>
}
