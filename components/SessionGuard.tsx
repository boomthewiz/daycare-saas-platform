"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { sessionRequest } from "@/lib/device-session-client"
import type { DeviceState } from "@/lib/device-session-server"

const IDLE = 5 * 60 * 1000
const publicPaths = new Set(["/login", "/auth/confirm", "/set-pin", "/request-access", "/onboarding", "/onboarding-owner"])
type Screen = DeviceState["state"] | "checking" | "offline"

export default function SessionGuard({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const exempt = publicPaths.has(path)
  const [screen, setScreen] = useState<Screen>("checking")
  const [mounted, setMounted] = useState(false)
  const [curtain, setCurtain] = useState(false)
  const [identity, setIdentity] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const mode = useRef<Screen>("checking")
  const deadline = useRef(0)
  const lastActivity = useRef(0)
  const hiddenAt = useRef<number | null>(null)
  const lastHeartbeat = useRef(0)
  const lastCheck = useRef(0)
  const generation = useRef(0)

  const show = useCallback((next: Screen) => { mode.current = next; setScreen(next) }, [])
  const check = useCallback(async (action = "status", enteredPin?: string) => {
    const current = ++generation.current
    try {
      const response = await fetch("/api/session-policy", { cache: "no-store" })
      const policy = await response.json()
      if (!response.ok || typeof policy.enabled !== "boolean") throw new Error("Unable to check session protection.")
      const active = policy.enabled || new URL(window.location.href).searchParams.get("session-policy-preview") === "1"
      if (generation.current !== current) return
      setEnabled(active)
      if (!active) { setMounted(true); return }
      const state = await sessionRequest(action, enteredPin)
      if (generation.current !== current) return
      if (state.state === "unlocked") {
        const now = Date.parse(state.serverNow || "")
        const remaining = Math.min(Date.parse(state.unlockedUntil || "") - now,
          Date.parse(state.fullAuthUntil || "") - now, Date.parse(state.pinRequiredBy || "") - now)
        if (!Number.isFinite(remaining) || remaining <= 0) { show("locked"); return }
        deadline.current = performance.now() + remaining
        if (action === "unlock" || lastActivity.current === 0) lastActivity.current = performance.now()
        setMounted(true)
        setError("")
      }
      show(state.state)
      if (state.state === "setup") window.location.assign("/set-pin")
    } catch (e) {
      if (generation.current !== current) return
      setError(e instanceof Error ? e.message : "Unable to connect. Please try again.")
      if (action !== "unlock") show("offline")
    }
  }, [show])

  const lock = useCallback(() => {
    show("locked")
    setPin("")
    void check("lock")
  }, [check, show])

  useEffect(() => {
    if (exempt) return
    show("checking")
    setCurtain(document.hidden)
    hiddenAt.current = document.hidden ? performance.now() : null
    lastActivity.current = 0
    void supabase.auth.getUser().then(({ data }) => setIdentity(data.user?.id || ""))
    void check()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { generation.current++; setMounted(false); show("full_login") }
      if (event === "SIGNED_IN") {
        setIdentity(session?.user.id || "")
        // Never await Supabase calls from inside its auth callback.
        window.setTimeout(() => { void check() }, 0)
      }
    })
    const activity = (event: Event) => {
      if (!event.isTrusted || document.hidden || mode.current !== "unlocked") return
      const now = performance.now()
      if (now >= deadline.current || (lastActivity.current && now-lastActivity.current >= IDLE)) { lock(); return }
      lastActivity.current = now
      // Only genuine foreground interaction renews the server lease. Polls,
      // token refreshes, session timers and background tabs do not count.
      if (now-lastHeartbeat.current >= 10000) {
        lastHeartbeat.current = now
        void check("activity")
      }
    }
    const visibility = () => {
      if (document.hidden) {
        hiddenAt.current = performance.now()
        setCurtain(true)
      } else {
        const hiddenFor = hiddenAt.current === null ? 0 : performance.now()-hiddenAt.current
        hiddenAt.current = null
        if (hiddenFor >= IDLE || performance.now() >= deadline.current) lock()
        else void check()
        setCurtain(false)
      }
    }
    const events = ["pointerdown", "keydown", "touchstart", "scroll"]
    events.forEach(name => window.addEventListener(name, activity, { passive: true, capture: true }))
    document.addEventListener("visibilitychange", visibility)
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (mode.current === "unlocked" && (now >= deadline.current || (lastActivity.current && now-lastActivity.current >= IDLE))) lock()
      else if (!document.hidden && mode.current === "unlocked" && lastActivity.current > lastHeartbeat.current && now-lastActivity.current >= 1000) {
        lastHeartbeat.current = now
        void check("activity")
      }
      if (!document.hidden && now-lastCheck.current >= 30000) { lastCheck.current = now; void check() }
    }, 1000)
    return () => {
      // This is a request-generation counter, not a DOM ref. Invalidate every
      // pending response on cleanup rather than capturing an earlier value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      subscription.unsubscribe()
      events.forEach(name => window.removeEventListener(name, activity, true))
      document.removeEventListener("visibilitychange", visibility)
      window.clearInterval(timer)
    }
  }, [exempt, check, lock, show])

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !/^\d{4}$/.test(pin)) return
    setBusy(true); setError("")
    await check("unlock", pin)
    setPin(""); setBusy(false)
  }
  const signOut = async () => {
    setBusy(true)
    try {
      await sessionRequest("logout")
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" })
      if (signOutError) throw signOutError
      setMounted(false)
      window.location.assign("/login")
    } catch { setError("Unable to finish signing out. Please reconnect and try again."); setBusy(false) }
  }

  if (exempt) return <>{children}</>
  if (enabled === false) return <>{children}</>
  const covered = screen !== "unlocked" || curtain
  return <>
    {mounted && <div key={identity} hidden={covered} inert={covered}>{children}</div>}
    {!covered && <div className="fixed bottom-3 right-3 z-40 flex gap-2 rounded-full bg-white p-2 shadow border border-slate-200">
      <button className="px-3 py-1 text-sm text-slate-600" onClick={lock}>Lock</button>
      <button className="px-3 py-1 text-sm text-slate-600" onClick={signOut} disabled={busy}>Sign out</button>
    </div>}
    {covered && <main className="fixed inset-0 z-50 grid place-items-center bg-slate-50 p-6 overflow-auto">
      <section className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-8 shadow-sm text-center" aria-label="Unlock ReJoyce">
        <p className="text-sm font-semibold text-teal-700 mb-3">ReJoyce</p>
        <h1 className="text-2xl font-bold text-slate-800 mb-3">{screen === "full_login" ? "Sign in to continue" : screen === "inactive" ? "Account unavailable" : screen === "checking" || curtain ? "Checking your session…" : "Welcome back"}</h1>
        {screen === "locked" && !curtain && <form onSubmit={unlock}>
          <p className="text-slate-500 mb-6">Enter your PIN to pick up where you left off.</p>
          <label className="sr-only" htmlFor="unlock-pin">Four-digit PIN</label>
          <input id="unlock-pin" autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,""))} className="w-full rounded-xl border p-4 text-center text-2xl tracking-widest" />
          <button disabled={busy || pin.length !== 4} className="mt-4 w-full rounded-xl bg-teal-700 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "Unlock"}</button>
          <a href="/login" target="_blank" rel="noopener noreferrer" className="block mt-4 text-sm text-slate-500 underline">Forgot PIN? Sign in with email</a>
        </form>}
        {screen === "full_login" && <><p className="text-slate-500 mb-5">For your security, please confirm your email again. This is required after 30 days, or seven days without using your PIN.</p><a href="/login" target="_blank" rel="noopener noreferrer" className="block rounded-xl bg-teal-700 py-3 text-white">Continue with email</a><p className="mt-3 text-sm text-slate-500">Keep this page open to preserve your work.</p></>}
        {screen === "inactive" && <p>Contact your administrator to restore access.</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        {screen === "offline" && <button className="mt-4 underline" onClick={() => void check()}>Reconnect and try again</button>}
        {!["checking"].includes(screen) && <button disabled={busy} className="mt-6 text-sm text-slate-500 underline" onClick={signOut}>Sign out of this device</button>}
      </section>
    </main>}
  </>
}
