"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

export function useUnsavedSessionChanges(dirty: boolean, saving: boolean, enabled: boolean) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const resolve = useRef<((discard: boolean) => void) | null>(null)
  const bypass = useRef(false)
  const keepButton = useRef<HTMLButtonElement>(null)
  const decide = useCallback((discard: boolean) => {
    const pending = resolve.current
    resolve.current = null
    setAsking(false)
    pending?.(discard)
  }, [])
  const confirmLeave = useCallback(async () => {
    if (saving) return false
    if (!dirty || bypass.current) return true
    if (resolve.current) return false
    setAsking(true)
    return new Promise<boolean>(done => { resolve.current = done })
  }, [dirty, saving])

  useEffect(() => {
    if (!asking) return
    const previousFocus = document.activeElement as HTMLElement | null
    keepButton.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); decide(false) }
      if (event.key === "Tab") {
        const buttons = document.querySelectorAll<HTMLButtonElement>('[data-session-discard-dialog] button')
        if (buttons.length && ((event.shiftKey && document.activeElement === buttons[0]) || (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]))) {
          event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0].focus()
        }
      }
    }
    document.addEventListener("keydown", key)
    return () => { document.removeEventListener("keydown", key); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [asking, decide])
  useEffect(() => () => { resolve.current?.(false) }, [])

  useEffect(() => {
    if (!dirty && !saving) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return
      event.preventDefault(); event.returnValue = ""
    }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === window.location.href) return
      event.preventDefault(); event.stopImmediatePropagation()
      const url = new URL(anchor.href)
      void confirmLeave().then(discard => {
        if (!discard) return
        bypass.current = true
        if (url.origin === window.location.origin) router.push(url.pathname + url.search + url.hash)
        else window.location.assign(url.href)
      })
    }
    window.addEventListener("beforeunload", beforeUnload)
    document.addEventListener("click", click, true)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      document.removeEventListener("click", click, true)
    }
  }, [dirty, saving, confirmLeave, router])

  useEffect(() => {
    if (!enabled) return
    const marker = "rejoyceSessionEditor"
    const ownUrl = window.location.href
    // A same-document entry makes Back reviewable before the editor unmounts.
    // Keep Next's state intact, and skip this entry when the form is clean.
    if (dirty && !window.history.state?.[marker]) {
      window.history.pushState({ ...window.history.state, [marker]: true }, "", ownUrl)
    }
    let passing = false
    const pop = (event: PopStateEvent) => {
      if (passing || window.location.href !== ownUrl || event.state?.[marker]) return
      event.stopImmediatePropagation()
      if (!dirty && !saving) { passing = true; window.history.back(); return }
      window.history.pushState({ ...window.history.state, [marker]: true }, "", ownUrl)
      void confirmLeave().then(discard => {
        if (!discard) return
        passing = true; bypass.current = true
        window.history.go(-2)
      })
    }
    window.addEventListener("popstate", pop, true)
    return () => window.removeEventListener("popstate", pop, true)
  }, [dirty, saving, confirmLeave, enabled])

  const discardDialog = asking ? (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="session-discard-title" aria-describedby="session-discard-description" data-session-discard-dialog className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="session-discard-title" className="rj-heading-2">Discard unsaved changes?</h2>
        <p id="session-discard-description" className="mt-3">Your session changes have not been saved. Keep editing to save them, or discard them to leave.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button ref={keepButton} type="button" onClick={() => decide(false)} className="rj-button rj-button-secondary">Keep editing</button>
          <button type="button" onClick={() => decide(true)} className="rj-button rj-button-danger">Discard changes</button>
        </div>
      </div>
    </div>
  ) : null
  return { confirmLeave, discardDialog }
}
