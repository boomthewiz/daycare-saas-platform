"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()

  const [fullName, setFullName] = useState("User")
  const [userRole, setUserRole] = useState("teacher")

  // ✨ Dynamic page title map
  const pageTitles: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/operations": "Operations Setup",
    "/invite-teacher": "Team Management",
    "/request-access": "Access Requests",
    "/billing": "Billing & Subscription",
    "/reports": "Reports",
    "/profile": "My Profile",
  }

  const pageSubtitles: Record<string, string> = {
    "/dashboard": "Track daily workflows and team progress",
    "/operations": "Configure recurring tasks and workflow structure",
    "/invite-teacher": "Manage your team and staff access",
    "/request-access": "Review and manage owner access requests",
    "/billing": "Manage plans, subscriptions, and invoices",
    "/reports": "Track performance and operational insights",
    "/profile": "Manage your personal account settings",
  }

  const title = pageTitles[pathname] || "ReJoyce"
  const subtitle =
    pageSubtitles[pathname] || "Workflow management made simple"

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data } = await supabase
        .from("users")
        .select("full_name, role")
        .eq("id", user.id)
        .single()

      if (data) {
        setFullName(data.full_name || "User")
        setUserRole(data.role || "teacher")
      }
    }

    fetchUser()
  }, [])

  return (
    <div className="w-full bg-white border-b border-pink-100 px-6 py-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

        {/* Left Side */}
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            ✨ {title}
          </h1>

          <p className="text-sm text-gray-500 mt-1">
            {subtitle}
          </p>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">

          {/* 👑 Owner Quick Action */}
          {userRole === "owner" && (
            <button
              onClick={() => router.push("/operations")}
              className="px-5 py-3 rounded-2xl font-semibold text-white shadow-lg bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 hover:scale-105 transition-all"
            >
              ✨ New Workflow
            </button>
          )}

          {/* 👩‍🏫 Teacher Quick Action */}
          {userRole === "teacher" && (
            <button
              onClick={() => router.push("/tasks")}
              className="px-5 py-3 rounded-2xl font-semibold text-white shadow-lg bg-gradient-to-r from-blue-400 to-cyan-400 hover:scale-105 transition-all"
            >
              📋 My Tasks
            </button>
          )}

          {/* 👤 User Bubble */}
          <div className="w-12 h-12 rounded-full bg-gradient-to-r from-pink-300 to-purple-300 flex items-center justify-center text-white font-bold shadow-md">
            {fullName.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  )
}