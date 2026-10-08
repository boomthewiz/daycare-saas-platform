"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePortal } from "@/components/PortalProvider"
import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"
import { defaultTerms, normalizeTerms, themes, vocabularyPresets, type PortalTerms, type PortalTheme } from "@/lib/portal-presets"
import { useSetupAccess } from "@/lib/use-setup-access"
import { supabase } from "@/lib/supabase"

export default function AppearancePage() {
  const portal = usePortal(), access = useSetupAccess()
  const [terms, setTerms] = useState<PortalTerms>(defaultTerms)
  const [theme, setTheme] = useState<PortalTheme>("rejoyce")
  const [org, setOrg] = useState("")
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [error, setError] = useState(""), [message, setMessage] = useState("")
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const organization = await supabase.rpc("current_organization_id")
        if (organization.error || !organization.data) throw new Error("Unable to load your business. Unlock your session and try again.")
        const result = await supabase.from("organization_terminology").select("*").eq("organization_id", organization.data).maybeSingle()
        if (result.error) throw new Error(result.error.message)
        if (!live) return
        setOrg(organization.data); setTerms(normalizeTerms(result.data))
        setTheme(themes.some(option => option.id === result.data?.portal_theme) ? result.data.portal_theme : "rejoyce")
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Unable to load presets.") }
      finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
  }, [])
  const allowed = !access.loading && !access.error && (access.clients || access.sessions)
  async function save() {
    setError(""); setMessage("")
    if (!allowed || !org) { setError("Management permission is required to save presets."); return }
    if (Object.values(terms).some(value => !value.trim() || value.trim().length > 60)) { setError("Enter 1–60 characters for every term."); return }
    setSaving(true)
    try {
      const values = Object.fromEntries(Object.entries(terms).map(([key, value]) => [key, value.trim()]))
      const result = await supabase.from("organization_terminology").upsert({ organization_id: org, ...values, portal_theme: theme }, { onConflict: "organization_id" }).select("organization_id")
      if (result.error) throw new Error(result.error.message)
      if (!result.data?.length) throw new Error("The settings were not saved. Check your permissions and retry.")
      await portal.refresh(); setMessage("Portal appearance and vocabulary saved for your business.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save. Your preview has been kept.") }
    finally { setSaving(false) }
  }
  if (loading) return <p role="status">Loading portal presets…</p>
  return <div className="mx-auto max-w-5xl space-y-6">
    <Link href="/setup" className="underline">Back to Setup</Link>
    <h1 className="rj-heading-1">Portal appearance and vocabulary</h1>
    <p>Choose your business vocabulary and visual theme independently. Preview changes before saving them for everyone in your business.</p>
    {(error || access.error) && <p role="alert" className="rounded-xl bg-red-50 p-3">{error || access.error}</p>}
    {message && <p role="status">{message}</p>}
    {!allowed && <p>View presets here. Manage clients or Manage sessions permission is required to save.</p>}
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rj-card space-y-4 p-5">
        <h2 className="rj-heading-3">Business vocabulary</h2>
        <label className="block">Start from a preset
          <select defaultValue="" className="rj-input mt-2 w-full" onChange={event => { const preset = vocabularyPresets.find(item => item.id === event.target.value); if (preset) { setTerms({ ...preset.terms }); setMessage("") } }}>
            <option value="" disabled>Choose a preset</option>{vocabularyPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <p className="text-sm">Applying a vocabulary preset replaces the terms in this preview. You can customize them before saving. Roles and permissions keep their existing meanings.</p>
        {(["client", "frontline", "session", "target"] as const).map((group, index) => <fieldset key={group} className="grid grid-cols-2 gap-3"><legend className="mb-1 font-semibold">{["People receiving services", "People delivering services", "Scheduled services", "Goals and targets"][index]}</legend>
          {(["singular", "plural"] as const).map(number => { const key = `${group}_${number}` as keyof PortalTerms; return <label key={key} className="block text-sm">{number === "singular" ? "Singular" : "Plural"}<input className="rj-input mt-1 w-full" maxLength={60} value={terms[key]} onChange={event => { setTerms(current => ({ ...current, [key]: event.target.value })); setMessage("") }} /></label> })}
        </fieldset>)}
      </section>
      <section className="space-y-4">
        <div className="rj-card space-y-3 p-5"><h2 className="rj-heading-3">Visual theme</h2>{themes.map(option => <label key={option.id} className="flex cursor-pointer gap-3 rounded-xl border p-3"><input type="radio" name="portal-theme" value={option.id} checked={theme === option.id} onChange={() => { setTheme(option.id); setMessage("") }} /><span><strong>{option.name}</strong><span className="block text-sm">{option.description}</span></span></label>)}</div>
        <div data-portal-preview={theme} className="rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-[var(--rj-background)] p-5">
          <p className="mb-3 text-sm font-semibold">Preview only</p>
          <div className="flex flex-wrap gap-3 text-sm text-[var(--rj-teal-700)]"><span>{terms.client_plural}</span><span>{terms.frontline_plural}</span><span>{terms.session_plural}</span></div>
          <div className="mt-4 rounded-xl bg-white p-4"><h3 className="font-semibold">Upcoming {terms.session_plural.toLowerCase()}</h3><p className="my-3">{terms.client_singular}: Sample person</p><p>{terms.frontline_singular}: Sample worker</p><span className="mt-3 inline-block rounded-full bg-[var(--rj-teal-100)] px-3 py-1 text-[var(--rj-teal-700)]">{terms.target_plural}</span></div>
        </div>
      </section>
    </div>
    <SubscriptionWriteControls><button className="rj-button rj-button-primary" disabled={!allowed || saving || !org} onClick={() => void save()}>{saving ? "Saving…" : "Save portal settings"}</button></SubscriptionWriteControls>
  </div>
}
