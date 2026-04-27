"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const [userRole, setUserRole] = useState<"owner" | "teacher">("teacher")
  const [loading, setLoading] = useState(true)

  // 🔐 Fetch current user + role
  useEffect(() => {
    const fetchUserRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      // Pull role from your public.users table
      const { data, error } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single()

      if (error || !data) {
        console.error("Role fetch error:", error)
        setUserRole("teacher")
      } else {
        setUserRole(data.role)
      }

      setLoading(false)
    }

    fetchUserRole()
  }, [])

  // 🚪 Logout
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const isActive = (path: string) =>
    pathname === path
      ? "bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white shadow-lg"
      : "text-gray-700 hover:bg-pink-50"

  if (loading) {
    return (
      <div className="w-72 min-h-screen bg-white border-r p-6">
        <p className="text-gray-500">Loading menu...</p>
      </div>
    )
  }

  return (
    <div className="w-72 min-h-screen bg-white border-r border-pink-100 p-6 flex flex-col justify-between">

      {/* Top Section */}
      <div>

        {/* 🫧 Brand */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-800">
            ✨ ReJoyce
          </h1>
          <p className="text-sm text-gray-500">
            Workflow System
          </p>
        </div>

        {/* Shared Navigation */}
        <div className="space-y-2">

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Daily Workflow
          </p>

          <Link
            href="/dashboard"
            className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/dashboard")}`}
          >
            🏠 Dashboard
          </Link>

          <Link
            href="/tasks"
            className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/tasks")}`}
          >
            📋 My Tasks
          </Link>

          <Link
            href="/children"
            className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/children")}`}
          >
            🧒 Groups / Children
          </Link>

          <Link
            href="/notes"
            className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/notes")}`}
          >
            📝 Logs & Notes
          </Link>
        </div>

        {/* 👑 Admin Section */}
        {userRole === "owner" && (
          <div className="mt-8 space-y-2">

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Admin Controls
            </p>

            <Link
              href="/operations"
              className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/templates")}`}
            >
              ⚙️ Operations Setup
            </Link>

            <Link
              href="/team-management"
              className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/invite-teacher")}`}
            >
              👥 Team Management
            </Link>

            <Link
              href="/request-access"
              className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/request-access")}`}
            >
              ✨ Access Requests
            </Link>

            <Link
              href="/billing"
              className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/billing")}`}
            >
              💳 Billing
            </Link>

            <Link
              href="/reports"
              className={`block px-4 py-3 rounded-2xl font-medium transition-all ${isActive("/reports")}`}
            >
              📊 Reports
            </Link>
          </div>
        )}
      </div>

      {/* Bottom Section */}
      <div className="pt-8 border-t border-pink-100">

        <Link
          href="/profile"
          className={`block px-4 py-3 rounded-2xl font-medium transition-all mb-2 ${isActive("/profile")}`}
        >
          👤 My Profile
        </Link>

        <button
          onClick={handleLogout}
          className="w-full text-left px-4 py-3 rounded-2xl font-medium text-gray-700 hover:bg-red-50 transition-all"
        >
          🚪 Logout
        </button>
      </div>
    </div>
  )
}