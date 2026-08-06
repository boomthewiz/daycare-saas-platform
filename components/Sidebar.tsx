"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import {
  LayoutDashboard,
  Settings2,
  CalendarDays,
  Users,
  Inbox,
  CreditCard,
  BarChart3,
  UserRound,
  ListChecks,
} from "lucide-react"

export default function Sidebar() {
  const pathname = usePathname()

  const [collapsed, setCollapsed] = useState(false)
  type UserRole =
  | "owner"
  | "admin"
  | "manager"
  | "director"
  | "therapist"
  | "teacher"
  | "educator"
  | "assistant"
  | "aide"
  | "caregiver"
  | "staff"

const [role, setRole] = useState<UserRole | null>(null)

  // 🔐 Fetch user role
  useEffect(() => {
    const fetchRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single()

      if (data?.role) {
        setRole(data.role)
      }
    }

    fetchRole()
  }, [])

  // 🧠 Role-based nav config

const ownerNav = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Sessions",
    href: "/sessions",
    icon: CalendarDays,
  },
  {
    name: "Operations",
    href: "/operations",
    icon: Settings2,
  },
  {
    name: "Team",
    href: "/team-management",
    icon: Users,
  },
  {
    name: "Access Requests",
    href: "/access-requests",
    icon: Inbox,
  },
  {
    name: "Billing",
    href: "/billing",
    icon: CreditCard,
  },
  {
    name: "Reports",
    href: "/reports",
    icon: BarChart3,
  },
  {
    name: "Profile",
    href: "/profile",
    icon: UserRound,
  },
]

const staffNav = [
  {
    name: "Home",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "My Sessions",
    href: "/my-sessions",
    icon: CalendarDays,
  },
  {
    name: "Tasks",
    href: "/tasks",
    icon: ListChecks,
  },
  {
    name: "Profile",
    href: "/profile",
    icon: UserRound,
  },
]

const adminRoles: UserRole[] = [
  "owner",
  "admin",
  "manager",
  "director",
]

const navItems =
  role && adminRoles.includes(role)
    ? ownerNav
    : staffNav

  return (
    <div
      className={`h-screen bg-white border-r shadow-sm flex flex-col transition-all duration-300 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* 🫧 Top */}
      <div className="flex items-center justify-between p-4">
        {!collapsed && (
          <h1 className="text-lg font-bold text-gray-800">
            ReJoyce
          </h1>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          {collapsed ? "➡️" : "⬅️"}
        </button>
      </div>

      {/* 📍 Navigation */}
      <nav className="flex flex-col gap-2 px-2">

        {navItems.map((item) => {
  const Icon = item.icon

  return (
    <Link
      key={item.href}
      href={item.href}
      className="flex items-center gap-3 px-4 py-3 rounded-xl"
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
})}
      </nav>

      {/* 🧍 Footer */}
      <div className="mt-auto p-4">
        {!collapsed ? (
          <div className="text-sm text-gray-500">
            {role === "owner"
              ? "Owner Mode 👑"
              : "Staff Mode 👩‍🏫"}
          </div>
        ) : (
          <div className="text-center">✨</div>
        )}
      </div>
    </div>
  )
}