"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import {
  ChevronLeft,
  ChevronRight,
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

export default function Sidebar() {
  const pathname = usePathname()

  const [collapsed, setCollapsed] = useState(false)
  const [permissions, setPermissions] =
    useState<UserPermissions>(defaultPermissions)

  const [loadingPermissions, setLoadingPermissions] =
    useState(true)

  const [isOwner, setIsOwner] = useState(false)

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
  }, [permissions, loadingPermissions])

  return (
    <aside
      className={`h-screen bg-white border-r shadow-sm flex flex-col transition-all duration-300 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center ${
          collapsed
            ? "justify-center"
            : "justify-between"
        } p-4`}
      >
        {!collapsed && (
          <h1 className="text-lg font-bold text-gray-800">
            ReJoyce
          </h1>
        )}

        <button
          type="button"
          onClick={() =>
            setCollapsed((current) => !current)
          }
          aria-label={
            collapsed
              ? "Expand sidebar"
              : "Collapse sidebar"
          }
          className="p-2 rounded-lg hover:bg-gray-100 transition"
        >
          {collapsed ? (
            <ChevronRight size={20} />
          ) : (
            <ChevronLeft size={20} />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav
        className="flex flex-col gap-2 px-2"
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
                aria-current={
                  isActive ? "page" : undefined
                }
                title={
                  collapsed
                    ? item.name
                    : undefined
                }
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition ${
                  collapsed
                    ? "justify-center"
                    : ""
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

                {!collapsed && (
                  <span>{item.name}</span>
                )}
              </Link>
            )
          })
        )}
      </nav>

      {/* Footer */}
      <div className="mt-auto p-4">
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