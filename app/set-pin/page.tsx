"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { sessionRequest } from "@/lib/device-session-client"

type SetupScreen = "checking" | "ready" | "reauth" | "inactive" | "error"

export default function SetPinPage() {
  const router = useRouter()
  const [screen, setScreen] = useState<SetupScreen>("checking")
  const [pin, setPin] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    let generation = 0
    const check = async () => {
      const current = ++generation
      try {
        const state = await sessionRequest()
        if (cancelled || current !== generation) return
        if (state.state === "inactive") { setScreen("inactive"); return }
        if (state.state === "full_login") { setScreen("reauth"); return }
        if (state.state !== "setup") { router.replace("/dashboard"); return }
        setScreen(state.canSetPin ? "ready" : "reauth")
      } catch (cause) {
        if (cancelled || current !== generation) return
        setError(cause instanceof Error ? cause.message : "Unable to check your account.")
        setScreen("error")
      }
    }
    void check()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        generation++
        setPin(""); setConfirmation(""); setScreen("checking")
        // Leave the Auth callback before making another Auth request.
        window.setTimeout(() => { if (!cancelled) void check() }, 0)
      }
    })
    return () => { cancelled = true; generation++; subscription.unsubscribe() }
  }, [router])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || screen !== "ready") return
    setError("")
    if (!/^\d{4}$/.test(pin)) { setError("Choose a four-digit PIN."); return }
    if (pin !== confirmation) { setError("Your PINs do not match. Please enter them again."); setConfirmation(""); return }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setScreen("reauth"); return }
      const response = await fetch("/api/set-pin", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ pin }),
      })
      const result = await response.json()
      if (response.status === 401) { setScreen("reauth"); return }
      if (response.status === 403) { setScreen("inactive"); return }
      if (!response.ok) throw new Error(result.error || "Unable to save your PIN. Please try again.")
      router.replace("/dashboard")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save your PIN. Check your connection and try again.") }
    finally { setPin(""); setConfirmation(""); setBusy(false) }
  }

  const signOut = async () => {
    if (busy) return
    setBusy(true); setError("")
    try {
      await sessionRequest("logout")
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" })
      if (signOutError) throw signOutError
      router.replace("/login")
    } catch { setError("Unable to sign out. Check your connection and try again.") }
    finally { setBusy(false) }
  }

  return <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
    <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl" aria-labelledby="setup-title">
      <p className="text-center font-semibold text-teal-700 mb-3">ReJoyce</p>
      <h1 id="setup-title" className="text-center text-3xl font-bold text-slate-800">{screen === "checking" ? "Preparing your account." : screen === "reauth" ? "Confirm your email" : screen === "inactive" ? "Account unavailable" : "Set up your PIN"}</h1>
      {screen === "checking" && <p role="status" className="mt-4 text-center text-slate-600">Checking your sign-in securely.</p>}
      {screen === "ready" && <>
        <p className="mt-4 text-slate-600">Before entering your workspace, choose a four-digit PIN. You'll use it to unlock ReJoyce during the day.</p>
        <p className="mt-2 text-sm text-slate-500">This is different from the six-digit code in your email. PIN setup is required, and you can change it later in Profile.</p>
        <form onSubmit={save} className="mt-6 space-y-4">
          <div><label htmlFor="setup-pin" className="block text-sm font-medium text-slate-700 mb-2">Choose a four-digit PIN</label><input id="setup-pin" autoFocus type="password" inputMode="numeric" autoComplete="new-password" required pattern="[0-9]{4}" maxLength={4} disabled={busy} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-slate-300 p-4 text-center text-2xl tracking-widest" /></div>
          <div><label htmlFor="confirm-setup-pin" className="block text-sm font-medium text-slate-700 mb-2">Confirm your PIN</label><input id="confirm-setup-pin" type="password" inputMode="numeric" autoComplete="new-password" required pattern="[0-9]{4}" maxLength={4} disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-slate-300 p-4 text-center text-2xl tracking-widest" /></div>
          <button disabled={busy || pin.length !== 4 || confirmation.length !== 4} className="w-full rounded-xl bg-teal-700 py-4 font-semibold text-white disabled:opacity-50">{busy ? "Saving your PIN." : "Save PIN and continue"}</button>
        </form>
      </>}
      {screen === "reauth" && <><p className="mt-4 text-slate-600">For your security, confirm your email again before setting your PIN. After signing in, you'll return here to finish setup.</p><a href="/login" className="block mt-6 rounded-xl bg-teal-700 py-3 text-center font-semibold text-white">Continue with email</a></>}
      {screen === "inactive" && <p className="mt-4 text-slate-600">Contact your administrator to restore access to your account.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {screen === "error" && <><button onClick={() => window.location.reload()} className="mt-5 w-full rounded-xl bg-teal-700 py-3 font-semibold text-white">Try again</button><a href="/login" className="block mt-4 text-center text-teal-800 underline">Return to sign in</a></>}
      {screen !== "checking" && <button disabled={busy} onClick={() => void signOut()} className="block mx-auto mt-6 text-sm text-slate-600 underline disabled:opacity-50">Sign out of this device</button>}
    </section>
  </main>
}
