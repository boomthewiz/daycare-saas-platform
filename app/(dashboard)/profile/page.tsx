"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import ProfilePinSettings from "@/components/ProfilePinSettings"

type Profile = { full_name: string | null; role: string | null; email: string }

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const auth = await supabase.auth.getUser()
      if (auth.error || !auth.data.user) throw new Error("Sign in again to load your account.")
      const result = await supabase.from("users").select("full_name,role").eq("id", auth.data.user.id).single()
      if (result.error) throw new Error("Unable to load your profile. Please try again.")
      setProfile({ ...result.data, email: auth.data.user.email || "" })
    } catch (cause) {
      setProfile(null)
      setError(cause instanceof Error ? cause.message : "Unable to load your profile.")
    } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  return <div className="mx-auto max-w-2xl space-y-6">
    <section className="rj-card space-y-4 p-4 sm:p-6">
      <h1 className="rj-heading-1">Profile</h1>
      <p className="rj-caption">Account details are read-only here. You can manage your PIN below.</p>
      {loading ? <p role="status">Loading profile…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="rj-button rj-button-secondary mt-3" onClick={() => void load()}>Try again</button></div> : profile && <dl className="space-y-4">
        <div><dt className="rj-label">Full name</dt><dd className="mt-1 break-words">{profile.full_name || "Not set"}</dd></div>
        <div><dt className="rj-label">Email address</dt><dd className="mt-1 break-all">{profile.email || "Not set"}</dd></div>
        <div><dt className="rj-label">Role</dt><dd className="mt-1 capitalize">{profile.role || "Not set"}</dd></div>
      </dl>}
    </section>
    <ProfilePinSettings />
  </div>
}
