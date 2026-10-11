"use client"
import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import Header from "@/components/Header"
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react"
import Sidebar from "@/components/Sidebar"
export default function WorkspaceNavigation({ sticky = false, children }: { sticky?: boolean; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
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
    <Header navigation={<>
      <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="desktop-navigation" onClick={() => setCollapsed(current => !current)} className="hidden h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100 sm:flex">
        {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>
    <button ref={trigger} type="button" aria-label="Open navigation menu" aria-controls="mobile-navigation" aria-expanded="false"
      className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100 sm:hidden"
      onClick={() => { dialog.current?.showModal(); trigger.current?.setAttribute("aria-expanded", "true") }}><ChevronDown size={20} /></button>
    </>} />
    <div className="flex min-w-0 flex-1">
      <div id="desktop-navigation" className="hidden sm:block"><Sidebar sticky={sticky} collapsed={collapsed} /></div>
      {children}
    </div>
    <dialog id="mobile-navigation" ref={dialog} aria-label="Navigation menu"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto border-0 bg-white p-0"
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
      <div className="flex min-h-16 items-center gap-2 border-b px-3 py-2"><button autoFocus type="button" aria-label="Close navigation" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100" onClick={close}><ChevronUp size={20} /></button><span className="text-lg font-bold">ReJoyce</span></div>
      <Sidebar mobile onNavigate={close} />
    </dialog>
  </>
}
