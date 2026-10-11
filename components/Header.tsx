"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { BranchSelector } from "@/components/BranchProvider"

export default function Header({ navigation }: { navigation: ReactNode }) {
  const [fullName, setFullName] = useState("User")
  const pathname = usePathname()

  useEffect(() => {
    let mounted = true
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from("users").select("full_name").eq("id", user.id).single()
      if (mounted && data) setFullName(data.full_name || "User")
    }
    void fetchUser()
    return () => { mounted = false }
  }, [])

  return (
    <header className="flex min-h-16 w-full items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2 sm:px-4">
      <div className="flex shrink-0 items-center gap-2">
        {navigation}
        <Link href="/dashboard" className="flex min-h-11 items-center text-lg font-bold text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2">
          ReJoyce
        </Link>
      </div>
      {pathname === "/dashboard" && <p className="hidden min-w-0 flex-1 truncate px-4 text-sm text-gray-600 sm:block">Welcome back, {fullName === "User" ? "there" : fullName.trim().split(/\s+/)[0]}</p>}
      <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
        <BranchSelector />
        <Link href="/profile" aria-label={`My profile: ${fullName}`} title="My profile"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-pink-300 to-purple-300 font-bold text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2">
          {fullName.charAt(0).toUpperCase()}
        </Link>
      </div>
    </header>
  )
}
