"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { usePortal } from "@/components/PortalProvider"
import { supabase } from "@/lib/supabase"
import { useDailySchedule } from "@/components/DailyScheduleProvider"
import {
  LoaderCircle,
} from "lucide-react"

import {
  navigationItems,
  type PermissionKey,
} from "@/config/navigation"

type UserPermissions = Record<PermissionKey, boolean>

const defaultPermissions: UserPermissions = {
  can_manage_billing: false,
  can_manage_access: false,
  can_manage_team: false,
  can_manage_operations: false,
  can_manage_clients: false,
  can_manage_sessions: false,
  can_review_sessions: false,
  can_view_reports: false,
  can_manage_settings: false,
  can_manage_users: false,
}

export default function Sidebar({ sticky = false, mobile = false, collapsed = false, onNavigate }: { sticky?: boolean; mobile?: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const { t } = usePortal()
  const pathname = usePathname()
  const daily = useDailySchedule()


  const [permissions, setPermissions] =
    useState<UserPermissions>(defaultPermissions)

  const [loadingPermissions, setLoadingPermissions] =
    useState(true)

  const [isOwner, setIsOwner] = useState(false)
  const [isNoteAdmin, setIsNoteAdmin] = useState(false)

  useEffect(() => {
    let mounted = true

    const fetchPermissions = async () => {
      setLoadingPermissions(true)

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user || !mounted) {
          return
        }

        /*
         * Get the user's role.
         *
         * We still retrieve the role because the owner has
         * organization-level authority that may not be fully
         * represented by the user_permissions row.
         */
        const { data: userData, error: userError } =
          await supabase
            .from("users")
            .select("role")
            .eq("id", user.id)
            .single()

        if (userError) {
          console.error(
            "Unable to load user role:",
            userError
          )
        }

        const owner =
          userData?.role === "owner"

        if (mounted) {
          setIsOwner(owner)
          setIsNoteAdmin(owner || userData?.role === "admin")
        }

        /*
         * Get this user's organization permissions.
         */
        const { data: permissionData, error: permissionError } =
          await supabase
            .from("user_permissions")
            .select(`
              can_manage_billing,
              can_manage_access,
              can_manage_team,
              can_manage_operations,
              can_manage_clients,
              can_manage_sessions,
              can_review_sessions,
              can_view_reports,
              can_manage_settings,
              can_manage_users
            `)
            .eq("user_id", user.id)
            .maybeSingle()

        if (permissionError) {
          console.error(
            "Unable to load user permissions:",
            permissionError
          )
        }

        if (!mounted) {
          return
        }

        if (permissionData) {
          setPermissions({
            can_manage_billing:
              permissionData.can_manage_billing ?? false,

            can_manage_access:
              permissionData.can_manage_access ?? false,

            can_manage_team:
              permissionData.can_manage_team ?? false,

            can_manage_operations:
              permissionData.can_manage_operations ?? false,

            can_manage_clients:
              permissionData.can_manage_clients ?? false,

            can_manage_sessions:
              permissionData.can_manage_sessions ?? false,

            can_review_sessions:
              permissionData.can_review_sessions ?? false,

            can_view_reports:
              permissionData.can_view_reports ?? false,

            can_manage_settings:
              permissionData.can_manage_settings ?? false,

            can_manage_users:
              permissionData.can_manage_users ?? false,
          })
        }
      } catch (error) {
        console.error(
          "Unexpected sidebar permission error:",
          error
        )
      } finally {
        if (mounted) {
          setLoadingPermissions(false)
        }
      }
    }

    fetchPermissions()

    return () => {
      mounted = false
    }
  }, [])

  /*
   * Only show navigation after permission loading is complete.
   *
   * This prevents administrative links from briefly appearing
   * before we know what the current user is allowed to access.
   */
  const visibleNavItems = useMemo(() => {
    if (loadingPermissions) {
      return []
    }

    return navigationItems.filter((item) => {
      if (item.href === "/team-management" && (isOwner || permissions.can_manage_clients || permissions.can_manage_users)) return true
      if (item.href === "/reviews" && isNoteAdmin) return true
      /*
       * Public-to-authenticated-user navigation.
       */
      if (item.permission === null) {
        return true
      }

      /*
       * Permission-based navigation.
       */
      return permissions[item.permission] === true
    })
  }, [permissions, loadingPermissions, isNoteAdmin, isOwner])

  return (
    <aside
      className={`${sticky ? "sticky top-0 h-dvh overflow-y-auto" : "min-h-[calc(100dvh-4rem)]"} ${mobile ? "w-full" : "w-20"} shrink-0 bg-white border-r shadow-sm flex flex-col transition-all duration-300 ${
        mobile ? "" : collapsed ? "sm:w-20" : "sm:w-64"
      }`}
    >
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
          visibleNavItems.map((item) => {
            const Icon = item.icon

            /*
             * Exact match for normal routes.
             *
             * For nested pages such as /reviews/[sessionId],
             * the parent navigation item remains active.
             */
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" &&
                pathname.startsWith(
                  `${item.href}/`
                ))

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
          })
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
    </aside>
  )
}
