"use client"
import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function ConfirmEmail() {
  const started = useRef(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (started.current) return
    started.current = true
    const complete = async () => {
      const proof = new URL(window.location.href).searchParams.get("proof")
      // getSession waits for the SDK's incoming email-link session initialization.
      const { data: { session } } = await supabase.auth.getSession()
      window.history.replaceState(null, "", "/auth/confirm")
      if (!session || !proof) throw new Error("This link could not be confirmed. Please request a new email link.")
      const response = await fetch("/api/device-session", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "complete_email", proof }),
      })
      const result = await response.json()
      if (!response.ok || !["unlocked", "setup"].includes(result.state)) throw new Error("This link has expired or was already used. Please request a new one.")
      window.location.replace(result.state === "setup" ? "/set-pin" : "/dashboard")
    }
    void complete().catch(e => setError(e instanceof Error ? e.message : "Unable to confirm sign-in."))
  }, [])
  return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md text-center">
    <h1 className="text-2xl font-bold mb-4">{error ? "Let’s try again" : "Confirming your sign-in…"}</h1>
    {error && <><p role="alert">{error}</p><a className="inline-block mt-5 underline" href="/login">Request a new link</a></>}
  </div></main>
}

