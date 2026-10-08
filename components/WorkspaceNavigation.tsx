"use client"
import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import Sidebar from "@/components/Sidebar"
export default function WorkspaceNavigation({ sticky = false }: { sticky?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()
  const close = () => dialog.current?.close()
  useEffect(() => { dialog.current?.close() }, [pathname])
  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)")
    const resize = () => { if (media.matches) dialog.current?.close() }
    media.addEventListener("change", resize)
    return () => media.removeEventListener("change", resize)
  }, [])
  return <>
    <div className="hidden sm:block"><Sidebar sticky={sticky} /></div>
    <button ref={trigger} type="button" aria-label="Open navigation menu" aria-controls="mobile-navigation" aria-expanded="false"
      className="m-3 self-start rounded-xl border bg-white px-4 py-3 font-semibold shadow-sm sm:hidden"
      onClick={() => { dialog.current?.showModal(); trigger.current?.setAttribute("aria-expanded", "true") }}>Menu</button>
    <dialog id="mobile-navigation" ref={dialog} aria-label="Navigation menu"
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,90vw)] max-w-none border-0 p-0 backdrop:bg-black/40"
      onKeyDown={event => {
        if (event.key !== "Tab") return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')).filter(element => element.getClientRects().length > 0)
        const first = controls[0], last = controls[controls.length - 1]
        if (!first || !last) { event.preventDefault(); return }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}
      onClose={() => { trigger.current?.setAttribute("aria-expanded", "false"); trigger.current?.focus() }}
      onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX > bounds.right) close() } }}>
      <button autoFocus type="button" className="m-3 rounded-lg border p-3" onClick={close}>Close navigation</button>
      <Sidebar mobile onNavigate={close} />
    </dialog>
  </>
}


