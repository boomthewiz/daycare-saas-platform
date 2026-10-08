"use client"
import Link from "next/link"
import { usePortal } from "@/components/PortalProvider"
import { useSetupProgress } from "@/lib/use-setup-progress"
export default function SetupProgressChecklist() {
  const { terms } = usePortal()
  const { data, loading, error, refresh } = useSetupProgress()
  const steps = data ? [
    { done: data.session_type, label: `Active ${terms.session_singular.toLowerCase()} type`, href: "/setup/preferences", allowed: data.can_sessions },
    { done: data.client, label: `Active ${terms.client_singular.toLowerCase()} added`, href: "/team-management", allowed: data.can_clients },
    { done: data.staff_ready, label: `${terms.frontline_plural} ready for ${terms.session_plural.toLowerCase()}`, href: "/team-management", allowed: data.can_users },
    { done: data.scheduled, label: `First ${terms.session_singular.toLowerCase()} scheduled`, href: "/sessions", allowed: data.can_sessions },
  ] : []
  const next = steps.find(step => !step.done)
  return <section className="rj-card space-y-4 break-words p-5" aria-labelledby="setup-progress-title" aria-busy={loading}>
    <h2 id="setup-progress-title" className="rj-heading-3">Your first {terms.session_singular.toLowerCase()}</h2>
    <div aria-live="polite">
      {loading ? <p>Checking setup progress…</p> : error ? <p role="alert">{error}</p> : data && <>
        <p>{steps.filter(step => step.done).length} of {steps.length} milestones complete</p>
        <ol className="mt-3 space-y-3">{steps.map(step => <li key={step.label} className="flex flex-wrap items-center justify-between gap-2">
          <span>{step.done ? "✓ Complete: " : "○ To do: "}{step.label}</span>
          {!step.done && (step.allowed ? <Link className="underline" href={step.href}>Review setup</Link> : <span>Needs administrator</span>)}
        </li>)}</ol>
        <p className="mt-4 font-semibold">{next ? `Next: ${next.label}` : "First-session setup complete. You can schedule more at any time."}</p>
        {next && (next.allowed ? <Link className="rj-button rj-button-primary mt-2 max-w-full whitespace-normal text-center" href={next.href}>Continue setup</Link> : <p>Needs administrator — ask someone with management access to complete this step.</p>)}
        {!data.can_write && <p className="mt-2">Read-only access: an administrator must restore editing access before changes can be saved.</p>}
        <p className="mt-3 text-sm">Readiness means an active frontline account has confirmed access and completed PIN setup. Invitations alone do not count. Each person must still unlock their device to work.</p>
        <p className="mt-3 text-sm">Optional: saved branch {data.branch ? "configured" : "not configured"}; care assignments {data.care ? "configured" : "not configured"}. Scheduling supports a custom location and selecting a worker directly. Care groups and a default worker are shortcuts, not required milestones.</p>
      </>}
    </div>
    <button className="underline" disabled={loading} onClick={() => void refresh()}>{error ? "Retry progress" : "Refresh progress"}</button>
  </section>
}
