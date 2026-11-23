"use client"

import { useMemo } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { usePortal } from "@/components/PortalProvider"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { useDailySchedule } from "@/components/DailyScheduleProvider"
import {
  ChevronDown,
  LoaderCircle,
} from "lucide-react"

import { navigationItems, type NavigationItem } from "@/config/navigation"

const directLinks = ["/dashboard", "/my-sessions", "/tasks", "/attendance", "/sessions"]
const groups = [
  { name: "People", links: ["/team-management", "/classes", "/access-requests"] },
  { name: "Organization", links: ["/setup", "/billing"] },
  { name: "Reporting", links: ["/reports", "/reviews"] },
]

export default function Sidebar({ sticky = false, mobile = false, collapsed = false, onNavigate }: { sticky?: boolean; mobile?: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const { t } = usePortal()
  const pathname = usePathname()
  const daily = useDailySchedule()


  const { data: capabilities, loading: loadingPermissions, error, refresh } = useEffectiveCapabilities()
  const isOwner = capabilities?.owner === true
  const visibleNavItems = useMemo(() => loadingPermissions ? [] : navigationItems.filter(item =>
    (item.permission === null || capabilities?.[item.permission] === true) && (item.href !== "/reviews" || capabilities?.clinical === true)
  ), [capabilities, loadingPermissions])
  const isActiveRoute = (item: NavigationItem) =>
    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))

  function renderLink(item: NavigationItem) {
    const Icon = item.icon

    const isActive = isActiveRoute(item)

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-label={t(item.name)}
        aria-current={
          isActive ? "page" : undefined
        }
        title={t(item.name)}
        className={`flex ${mobile ? "flex-row justify-start gap-3" : "flex-col items-center justify-center gap-1 sm:flex-row sm:gap-3 sm:px-4"} px-2 py-3 rounded-xl transition ${
          collapsed
            ? "justify-center"
            : "sm:justify-start"
        } ${
          isActive
            ? "bg-gray-100 text-gray-900 font-semibold"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        }`}
      >
        <Icon
          size={20}
          strokeWidth={2}
          className="shrink-0"
        />

        <span className={`min-w-0 break-words leading-tight ${mobile ? "text-left text-base" : `text-center text-[10px] ${collapsed ? "sm:hidden" : "sm:text-left sm:text-base"}`}`}>{t(item.name)}</span>
      </Link>
    )
  }

  return (
    <aside
      className={`${sticky ? "sticky top-0 h-dvh overflow-y-auto" : "min-h-[calc(100dvh-4rem)]"} ${mobile ? "w-full" : "w-20"} shrink-0 bg-white border-r shadow-sm flex flex-col transition-all duration-300 ${
        mobile ? "" : collapsed ? "sm:w-20" : "sm:w-64"
      }`}
    >
      {error && <button className="p-3 text-sm underline" onClick={() => void refresh()}>Retry access check</button>}
      {/* Navigation */}
      <nav
        className="flex flex-col gap-2 px-2 pt-3"
        aria-label="Main navigation"
      >
        {loadingPermissions ? (
          <div className="flex justify-center py-4">
            <LoaderCircle
              size={20}
              className="animate-spin text-gray-400"
            />
          </div>
        ) : (
          <>
            {visibleNavItems.filter(item => directLinks.includes(item.href)).sort((a, b) => directLinks.indexOf(a.href) - directLinks.indexOf(b.href)).map(renderLink)}
            {groups.map(({ name, links }) => {
              const items = links.flatMap(href => visibleNavItems.filter(item => item.href === href))
              if (items.length < 2) return items.map(renderLink)

              const Icon = items[0].icon
              const active = items.some(isActiveRoute)
              return (
                <details className="rj-sidebar-submenu" key={`${name}:${pathname}`} open={active}>
                  <summary
                    title={t(name)}
                    aria-label={t(name)}
                    className={`flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl px-2 py-3 text-gray-600 hover:bg-gray-50 [&::-webkit-details-marker]:hidden ${collapsed ? "" : "sm:justify-start sm:px-4"} ${active ? "bg-gray-100 font-semibold" : ""}`}
                  >
                    <Icon size={20} className="shrink-0" aria-hidden="true" />
                    <span className={`min-w-0 break-words leading-tight ${mobile ? "" : collapsed ? "sr-only" : "text-[10px] sm:text-base"}`}>{t(name)}</span>
                    <ChevronDown size={14} className="rj-sidebar-chevron shrink-0" aria-hidden="true" />
                  </summary>
                  <div className={`flex flex-col gap-1 ${mobile || !collapsed ? "border-l border-gray-200 sm:ml-4" : ""}`}>
                    {items.map(renderLink)}
                  </div>
                </details>
              )
            })}
            {visibleNavItems.filter(item => item.href === "/profile").map(renderLink)}
          </>
        )}
      </nav>

      {!mobile && <section aria-label={t("Today's session totals")} className="mt-6 border-t px-3 py-4 text-sm">
        {daily.error ? <button title={daily.error} onClick={() => void daily.refresh()} className="min-h-11 text-gray-500 underline">{collapsed ? "Retry" : "Retry today's totals"}</button> : <>
          <div title={`${t("Today’s Sessions")}: ${daily.today ?? "Loading"}`} className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2 py-2`}>
            {!collapsed && <span className="text-gray-500">{t("Today’s Sessions")}</span>}<span className="font-bold" aria-label={collapsed ? `${t("Today’s Sessions")}: ${daily.today ?? "Loading"}` : undefined}>{daily.today ?? "—"}</span>
          </div>
          <div title={`Completed: ${daily.completed ?? "Loading"}`} className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2 py-2`}>
            {!collapsed && <span className="text-gray-500">Completed</span>}<span className="font-bold text-teal-700" aria-label={collapsed ? `Completed: ${daily.completed ?? "Loading"}` : undefined}>{daily.completed ?? "—"}</span>
          </div>
        </>}
      </section>}

      {/* Footer */}
      <div className="mt-auto hidden p-4 sm:block">
        {!collapsed ? (
          <div className="text-sm text-gray-500">
            {isOwner
              ? "Owner Mode"
              : "Staff Mode"}
          </div>
        ) : (
          <div className="text-center text-gray-400">
            ✨
          </div>
        )}
      </div>
      <style jsx global>{`
        .rj-sidebar-submenu[open] > summary > .rj-sidebar-chevron {
          transform: rotate(180deg);
        }

        @media (prefers-reduced-motion: no-preference) {
          .rj-sidebar-submenu > summary > .rj-sidebar-chevron {
            transition: transform 180ms ease-out;
          }

          @supports (interpolate-size: allow-keywords) and
                    (transition-behavior: allow-discrete) and
                    selector(details::details-content) {
            .rj-sidebar-submenu::details-content {
              interpolate-size: allow-keywords;
              block-size: 0;
              overflow: clip;
              transition: block-size 180ms ease-out, content-visibility 180ms allow-discrete;
            }

            .rj-sidebar-submenu[open]::details-content {
              block-size: auto;
            }
          }
        }
      `}</style>
    </aside>
  )
}
