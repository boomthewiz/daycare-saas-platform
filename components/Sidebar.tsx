"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

export default function Sidebar() {
  const pathname = usePathname()

  const [collapsed, setCollapsed] = useState(false)
  const [role, setRole] = useState<"owner" | "teacher" | "assistant" | "director" | null>(null)

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
    { name: "Dashboard", href: "/dashboard", icon: "📋" },
    { name: "Operations", href: "/operations", icon: "⚙️" },
    { name: "Team", href: "/team-management", icon: "👥" },
    { name: "Access Requests", href: "/access-requests", icon: "📨" },
    { name: "Billing", href: "/billing", icon: "💳" },
    { name: "Reports", href: "/reports", icon: "📊" },
    { name: "Profile", href: "/profile", icon: "👤" },
  ]

  const staffNav = [
    { name: "Dashboard", href: "/dashboard", icon: "📋" },
    { name: "My Tasks", href: "/tasks", icon: "✅" },
    { name: "Profile", href: "/profile", icon: "👤" },
  ]

  const navItems =
    role === "owner"
      ? ownerNav
      : role
      ? staffNav
      : []

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
          const active = pathname === item.href

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                active
                  ? "bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              <span className="text-lg">{item.icon}</span>

              {!collapsed && (
                <span className="font-medium">
                  {item.name}
                </span>
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