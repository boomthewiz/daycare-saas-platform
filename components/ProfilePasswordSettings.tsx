"use client"

import { useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

export default function ProfilePasswordSettings() {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(""); setSaved(false)
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) { setError("Choose at least 12 characters. If your password is very long, try a shorter one."); return }
    if (password !== confirmation) { setError("Your passwords do not match."); return }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error("Sign in again before setting your password.")
      const response = await fetch("/api/account-password", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ password }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to save your password.")
      setSaved(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save your password.") }
    finally { setPassword(""); setConfirmation(""); setBusy(false) }
  }
  return <section className="rj-card space-y-4 p-4 sm:p-6" aria-labelledby="password-heading">
    <h2 id="password-heading" className="text-2xl font-bold">Set or change password</h2>
    <p className="text-slate-600">Add a backup for signing in when email codes are unavailable. Your password is separate from your four-digit device PIN.</p>
    <p className="text-sm text-slate-500">Requires a sign-in within the last 10 minutes. Use a unique password of at least 12 characters; a password manager can help.</p>
    <form onSubmit={save} className="space-y-4">
      <div><label htmlFor="account-password" className="rj-label">New password</label><input id="account-password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} value={password} onChange={e => { setPassword(e.target.value); setSaved(false) }} disabled={busy} className="mt-2 w-full rounded-xl border p-3" /></div>
      <div><label htmlFor="confirm-account-password" className="rj-label">Confirm password</label><input id="confirm-account-password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} className="mt-2 w-full rounded-xl border p-3" /></div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {saved && <p role="status" className="text-teal-800">Password saved. You can now choose password login.</p>}
      <button disabled={busy} className="rj-button rj-button-primary w-full">{busy ? "Saving…" : "Save password"}</button>
    </form>
    <Link href="/login?next=/profile" className="block text-teal-800 underline">Sign in again to change your password</Link>
  </section>
}
