"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function StaffLoginPage() {
  const router = useRouter()

  const [staffMembers, setStaffMembers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [pin, setPin] = useState("")
  const [loading, setLoading] = useState(true)
  const [loggingIn, setLoggingIn] = useState(false)

  // 🔄 Load active staff members
  const fetchStaffMembers = async () => {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, role, username, is_active")
      .in("role", ["teacher", "assistant", "director"])
      .eq("is_active", true)
      .order("full_name", { ascending: true })

    if (error) {
      console.error("Fetch staff error:", error)
    }

    setStaffMembers(data || [])
    setLoading(false)
  }

  // 🔐 Handle PIN login
  const handlePinLogin = async () => {
    if (!selectedUser || !pin) {
      alert("Please enter your PIN")
      return
    }

    setLoggingIn(true)

    try {
      const response = await fetch("/api/staff-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: selectedUser.username,
          pin,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Login failed")
      }

      alert(`Welcome back, ${selectedUser.full_name} ✨`)
      router.push("/dashboard")
    } catch (error: any) {
      console.error(error)
      alert(error.message || "Invalid PIN")
    }

    setLoggingIn(false)
    setPin("")
  }

  useEffect(() => {
    fetchStaffMembers()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 flex items-center justify-center">
        <p className="text-lg text-gray-500">
          Loading staff members...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6 flex items-center justify-center">
      <div className="w-full max-w-5xl">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-800">
            👩‍🏫 Staff Login
          </h1>

          <p className="text-gray-500 mt-2">
            Tap your name and enter your PIN to continue
          </p>
        </div>

        {/* 👥 Staff Selection */}
        {!selectedUser && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {staffMembers.map((staff) => (
              <button
                key={staff.id}
                onClick={() => setSelectedUser(staff)}
                className="bg-white rounded-3xl shadow-lg p-6 hover:scale-105 transition-all duration-300 text-center"
              >
                <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-r from-pink-300 to-purple-300 flex items-center justify-center text-white text-2xl font-bold shadow-md mb-4">
                  {staff.full_name.charAt(0).toUpperCase()}
                </div>

                <h2 className="font-bold text-gray-800">
                  {staff.full_name}
                </h2>

                <p className="text-sm text-gray-500 capitalize mt-1">
                  {staff.role}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* 🔐 PIN Entry */}
        {selectedUser && (
          <div className="max-w-md mx-auto bg-white rounded-3xl shadow-xl p-8 text-center">

            <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-r from-pink-300 to-purple-300 flex items-center justify-center text-white text-3xl font-bold shadow-lg mb-5">
              {selectedUser.full_name.charAt(0).toUpperCase()}
            </div>

            <h2 className="text-2xl font-bold text-gray-800">
              {selectedUser.full_name}
            </h2>

            <p className="text-gray-500 mb-6">
              Enter your PIN to continue
            </p>

            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="w-full text-center text-2xl tracking-widest p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300 mb-5"
            />

            <button
              onClick={handlePinLogin}
              disabled={loggingIn}
              className="w-full py-4 rounded-2xl font-semibold text-white text-lg shadow-lg bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 hover:scale-105 transition-all"
            >
              {loggingIn
                ? "Signing In..."
                : "✨ Login"}
            </button>

            <button
              onClick={() => {
                setSelectedUser(null)
                setPin("")
              }}
              className="mt-4 text-sm text-gray-500 hover:text-gray-700"
            >
              ← Choose another staff member
            </button>
          </div>
        )}

      </div>
    </div>
  )
}