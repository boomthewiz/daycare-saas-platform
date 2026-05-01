"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(() => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("sidebar") === "collapsed"
  }
  return false
})

const toggleSidebar = () => {
  const newState = !collapsed
  setCollapsed(newState)

  localStorage.setItem(
    "sidebar",
    newState ? "collapsed" : "expanded"
  )
}

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: "📋" },
    { name: "Tasks", href: "/tasks", icon: "✅" },
    { name: "Operations", href: "/operations", icon: "⚙️" },
    { name: "Team", href: "/team-management", icon: "👥" },
    { name: "Access Requests", href: "/access-requests", icon: "📨" },
    { name: "Billing", href: "/billing", icon: "💳" },
    { name: "Reports", href: "/reports", icon: "📊" },
    { name: "Profile", href: "/profile", icon: "👤" },
  ]

  return (
    <div
      className={`h-screen bg-white border-r shadow-sm flex flex-col transition-all duration-300 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* 🫧 Top Section */}
      <div className="flex items-center justify-between p-4">
        {!collapsed && (
          <h1 className="text-lg font-bold text-gray-800">
            ReJoyce
          </h1>
        )}

        <button
          onClick={toggleSidebar}
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
            ReJoyce System ✨
          </div>
        ) : (
          <div className="text-center">✨</div>
        )}
      </div>
    </div>
  )
}