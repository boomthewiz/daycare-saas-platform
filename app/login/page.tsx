"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [resendAt, setResendAt] = useState(0)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [resendAt])

  const sendCode = async () => {
    if (busy || Date.now() < resendAt) return
    setBusy(true); setError("")
    try {
      const response = await fetch("/api/email-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to send a code.")
      setEmail(email.trim().toLowerCase()); setSent(true); setCode(""); setResendAt(Date.now() + 60000)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to send a code.") }
    finally { setBusy(false) }
  }
  const verifyCode = async () => {
    if (busy) return
    setBusy(true); setError("")
    try {
      const response = await fetch("/api/email-login/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to verify your code.")
      const { error: sessionError } = await supabase.auth.setSession(result.session)
      if (sessionError) throw new Error("Unable to save your sign-in. Please request a new code.")
      const destination = new URLSearchParams(window.location.search).get("next") === "/profile" ? "/profile" : "/dashboard"
      window.location.assign(result.state === "setup" ? "/set-pin" : destination)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in.") }
    finally { setBusy(false) }
  }

  return <main className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 flex items-center justify-center p-6">
    <section className="w-full max-w-md bg-white/95 rounded-3xl shadow-xl p-8 border border-white">
      <p className="text-center font-semibold text-teal-700 mb-3">ReJoyce</p>
      <h1 className="text-center text-3xl font-bold text-slate-800">{sent ? "Check your email" : "Welcome back"}</h1>
      <p className="text-center text-slate-600 mt-3 mb-7">{sent ? `If your account is active, a sign-in code is on its way to ${email}. Enter it below.` : "Sign in to your account with a code sent to your email."}</p>
      <form onSubmit={event => { event.preventDefault(); void (sent ? verifyCode() : sendCode()) }}>
        {sent ? <>
          <label htmlFor="email-code" className="block text-sm font-medium text-slate-700 mb-2">Email code</label>
          <input id="email-code" key="code" autoFocus required type="text" inputMode="numeric" autoComplete="one-time-code" pattern="([0-9]{6}|[0-9]{8})" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} disabled={busy} className="w-full p-4 rounded-xl border border-slate-300 text-center text-2xl tracking-widest" />
          <p className="mt-2 text-sm text-slate-500">Use the six-digit email code, not your four-digit PIN.</p>
        </> : <>
          <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-2">Email address</label>
          <input id="login-email" key="email" autoFocus required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} className="w-full p-4 rounded-xl border border-slate-300" />
        </>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <button disabled={busy || (sent && ![6, 8].includes(code.length))} className="mt-5 w-full py-4 rounded-xl font-semibold text-white bg-teal-700 disabled:opacity-50">{busy ? "Please wait…" : sent ? "Sign in" : "Send sign-in code"}</button>
      </form>
      {sent && <div className="mt-5 flex flex-col gap-3 text-center text-sm">
        <button disabled={busy || remaining > 0} onClick={() => void sendCode()} className="text-teal-800 underline disabled:text-slate-400">{remaining > 0 ? `Send another code in ${remaining}s` : "Send another code"}</button>
        <button disabled={busy} onClick={() => { setSent(false); setCode(""); setError(""); setResendAt(0) }} className="text-slate-600 underline">Use a different email</button>
      </div>}
      <div className="mt-8 text-center text-sm text-slate-600"><p>Need to register your organization?</p><Link href="/request-access" className="inline-block mt-2 font-semibold text-teal-800 underline">Request owner access</Link></div>
    </section>
  </main>
}
