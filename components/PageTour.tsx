"use client"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { tourSteps, tourStorageKey, parseTourProgress, type TourFamily } from "@/lib/page-tours"
import { usePortal } from "@/components/PortalProvider"
import { tutorials, getFeature } from "@/lib/feature-registry"

const progressEvent = "rejoyce:learning-changed"
function subscribeProgress(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(progressEvent, callback)
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(progressEvent, callback) }
}
export default function PageTour({ family, blocked = false }: { family: TourFamily; blocked?: boolean }) {
  // Opening/closing an editor resets active coaching, while persisted progress survives.
  return <TourContent key={`${family}:${blocked}`} family={family} blocked={blocked} />
}
function TourContent({ family, blocked }: { family: TourFamily; blocked: boolean }) {
  const { data: caps } = useEffectiveCapabilities()
  const { t } = usePortal()
  const moduleId = family === "people" ? (caps?.clients || caps?.sessions ? "base.people" : "base.staff") : `base.${family}`
  const definition = tutorials.find(tutorial => tutorial.id === moduleId)
  const source = definition && getFeature(definition.featureKey)
  const steps = definition?.maturity === "implemented" && source?.proposedBundle === "base" ? tourSteps(family, caps) : []
  const storageKey = caps ? tourStorageKey(caps.userId, caps.organizationId, family) : ""
  const read = useCallback(() => { try { return storageKey ? localStorage.getItem(storageKey) : null } catch { return null } }, [storageKey])
  const raw = useSyncExternalStore(subscribeProgress, read, () => null)
  const [fallback, setFallback] = useState<{ key: string; value: string } | null>(null)
  const progress = parseTourProgress(fallback?.key === storageKey ? fallback.value : raw, steps.length)
  const [activeKey, setActiveKey] = useState("")
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [storageError, setStorageError] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const replay = useRef<HTMLButtonElement>(null)
  const coach = useRef<HTMLElement>(null)
  const active = !!storageKey && activeKey === storageKey && !blocked && !!steps.length
  const step = steps[progress.step]
  const save = (next: typeof progress) => {
    const value = JSON.stringify(next)
    try { localStorage.setItem(storageKey, value); setFallback(null); window.dispatchEvent(new Event(progressEvent)) }
    catch { setStorageError(true); setFallback({ key: storageKey, value }) }
  }
  const pause = useCallback(() => { setActiveKey("") }, [])
  useEffect(() => {
    if (!active) return
    const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
    const previous = document.activeElement as HTMLElement | null
    const replayButton = replay.current
    target?.scrollIntoView({ block: "center", behavior: "instant" })
    heading.current?.focus()
    const measure = () => {
      if (!target || !target.getClientRects().length) { setRect(null); return }
      const box = target.getBoundingClientRect()
      setRect({ top: box.top-4, left: Math.max(4, box.left-4), width: Math.min(box.width+8, window.innerWidth-8), height: box.height+8 })
    }
    const observer = new ResizeObserver(measure)
    if (target) observer.observe(target)
    measure()
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true)
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); if (previous?.isConnected && previous.closest("[data-page-tour]")) replayButton?.focus() }
  }, [active, step?.target, progress.step])
  useEffect(() => {
    if (!active) return
    const hide = () => { if (document.hidden) pause() }
    const device = (event: Event) => { if ((event as CustomEvent<string>).detail !== "unlocked") pause() }
    const input = (event: Event) => { if (!coach.current?.contains(event.target as Node)) pause() }
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); pause(); replay.current?.focus() } }
    document.addEventListener("visibilitychange", hide); document.addEventListener("input", input, true)
    document.addEventListener("keydown", key); window.addEventListener("rejoyce:device-state", device)
    return () => { document.removeEventListener("visibilitychange", hide); document.removeEventListener("input", input, true); document.removeEventListener("keydown", key); window.removeEventListener("rejoyce:device-state", device) }
  }, [active, pause])
  if (!steps.length) return null
  return <section className="rj-card space-y-3 p-4" data-page-tour aria-label="Personal page help">
    <div className="flex flex-wrap items-center justify-between gap-3"><p>{progress.status === "new" ? "First visit? Take a short optional walkthrough." : progress.status === "completed" ? "Page walkthrough completed on this browser." : progress.status === "declined" ? "Page help is available whenever you need it." : "Your walkthrough is paused. Resume when ready."}</p>
      <button ref={replay} type="button" className="rj-button rj-button-secondary" disabled={blocked || active} onClick={() => { save({ step: progress.status === "paused" ? progress.step : 0, status: "paused" }); setActiveKey(storageKey) }}>{progress.status === "paused" ? "Resume walkthrough" : progress.status === "new" ? "Start walkthrough" : "Replay walkthrough"}</button>
      {progress.status === "new" && <button type="button" className="underline" onClick={() => save({ step: 0, status: "declined" })}>Not now</button>}
    </div>
    {blocked && <p>Walkthrough paused while an editor is open. Finish or close your work before resuming.</p>}
    {storageError && <p role="status">This browser could not save learning progress. Progress is kept only while this page stays open.</p>}
    <details><summary className="cursor-pointer underline">Written page help</summary><ol className="mt-3 list-decimal space-y-3 pl-5">{steps.map(item => <li key={item.title}><strong>{t(item.title)}</strong><p>{t(item.text)}</p></li>)}</ol></details>
    <p className="text-sm">Personal learning is saved for this user and organization on this browser. It does not change workspace readiness.</p>
    {active && <>
      {rect && <div aria-hidden="true" className="pointer-events-none fixed z-30 rounded-xl border-4 border-teal-600 ring-4 ring-white/80" style={rect} />}
      <aside ref={coach} role="region" aria-label="Page walkthrough" className="fixed inset-x-3 bottom-20 z-40 max-h-[55dvh] overflow-auto rounded-2xl border-2 border-teal-700 bg-white p-5 text-gray-900 shadow-xl sm:left-auto sm:right-6 sm:w-[26rem]">
        <p aria-hidden="true" className="text-teal-700">↑ Highlighted area</p><p className="text-sm" aria-live="polite">Step {progress.step+1} of {steps.length}</p>
        <h2 ref={heading} tabIndex={-1} className="mt-2 text-xl font-bold outline-none">{t(step.title)}</h2><p className="mt-3">{t(step.text)}</p>
        {!rect && <p className="mt-2 text-sm">This control is not currently visible. Use the written instructions or pause to review the page.</p>}
        <div className="mt-4 flex flex-wrap gap-3"><button type="button" className="rj-button rj-button-secondary" disabled={progress.step === 0} onClick={() => save({ step: progress.step-1, status: "paused" })}>Back</button><button type="button" className="rj-button rj-button-primary" onClick={() => {
          if (progress.step === steps.length-1) { save({ step: progress.step, status: "completed" }); pause(); replay.current?.focus() }
          else save({ step: progress.step+1, status: "paused" })
        }}>{progress.step === steps.length-1 ? "Finish walkthrough" : "Next"}</button><button type="button" className="underline" onClick={() => { pause(); replay.current?.focus() }}>Pause</button></div>
      </aside>
    </>}
  </section>
}
