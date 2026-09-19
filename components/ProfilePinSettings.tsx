"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"

export default function ProfilePinSettings() {
  const [pin, setPin] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [needsEmail, setNeedsEmail] = useState(false)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(""); setSaved(false); setNeedsEmail(false)
    if (!/^\d{4}$/.test(pin)) { setError("Enter a four-digit PIN."); return }
    if (pin !== confirmation) { setError("Your PINs do not match."); return }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setNeedsEmail(true); throw new Error("Please confirm your email before changing your PIN.") }
      const response = await fetch("/api/set-pin", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ pin }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 401) setNeedsEmail(true)
        throw new Error(result.error || "Unable to change your PIN. Please try again.")
      }
      setSaved(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to change your PIN.") }
    finally { setPin(""); setConfirmation(""); setBusy(false) }
  }

  return <section className="mt-6 rounded-3xl bg-white p-8 shadow-xl" aria-labelledby="pin-settings-heading">
    <h2 id="pin-settings-heading" className="text-2xl font-bold text-slate-800">Change PIN</h2>
    <p className="mt-2 text-slate-600">Your four-digit PIN unlocks ReJoyce during the day. This changes your PIN on all your devices.</p>
    <p className="mt-2 text-sm text-slate-500">For security, changing your PIN requires an email sign-in within the last 10 minutes. You can also use this to reset a forgotten PIN.</p>
    <form onSubmit={save} className="mt-6 space-y-4">
      <div><label htmlFor="new-profile-pin" className="block text-sm font-medium text-slate-700 mb-2">New PIN</label>
        <input id="new-profile-pin" type="password" inputMode="numeric" autoComplete="new-password" required pattern="[0-9]{4}" maxLength={4} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setSaved(false) }} disabled={busy} className="w-full rounded-xl border border-slate-300 p-4 tracking-widest" /></div>
      <div><label htmlFor="confirm-profile-pin" className="block text-sm font-medium text-slate-700 mb-2">Confirm new PIN</label>
        <input id="confirm-profile-pin" type="password" inputMode="numeric" autoComplete="new-password" required pattern="[0-9]{4}" maxLength={4} value={confirmation} onChange={e => setConfirmation(e.target.value.replace(/\D/g, ""))} disabled={busy} className="w-full rounded-xl border border-slate-300 p-4 tracking-widest" /></div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="text-sm text-teal-800">Your PIN has been changed.</p>}
      <button disabled={busy || pin.length !== 4 || confirmation.length !== 4} className="w-full rounded-xl bg-teal-700 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Saving PIN…" : "Save new PIN"}</button>
    </form>
    <a href="/login?next=/profile" target="_blank" rel="noopener noreferrer" className={`block mt-4 text-center text-teal-800 ${needsEmail ? "rounded-xl border border-teal-700 py-3 font-semibold" : "text-sm underline"}`}>Confirm email to change PIN</a>
    <p className="mt-2 text-xs text-slate-500 text-center">Opens in a new tab and brings you back to Profile.</p>
  </section>
}
