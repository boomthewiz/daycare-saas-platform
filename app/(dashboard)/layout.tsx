"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Sidebar from "@/components/Sidebar"
import Header from "@/components/Header"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      // ❌ Not logged in
      if (!session) {
        router.push("/login")
        return
      }

      // 🔐 Check PIN
      const { data: userData, error } = await supabase
        .from("users")
        .select("pin_hash")
        .eq("id", session.user.id)
        .single()

      if (error) {
        console.error("User fetch error:", error)
        return
      }

      // ❌ No PIN → force setup
      if (!userData?.pin_hash) {
        router.push("/set-pin")
        return
      }

      const pathname = window.location.pathname

if (!userData?.pin_hash && pathname !== "/set-pin") {
  router.push("/set-pin")
  return
}

      // ✅ Fully authenticated
      setLoading(false)
    }

    checkAuth()
  }, [])

  // ⏳ Global loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">
          Loading your workspace...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-gray-50">

      {/* Sidebar stays mounted */}
      <Sidebar />

      <div className="flex-1 flex flex-col">

        {/* Header stays mounted */}
        <Header />

        {/* Page content changes */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}