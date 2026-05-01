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

  // 🔄 Fetch staff
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

  useEffect(() => {
    fetchStaffMembers()
  }, [])

  // 🔐 Auto login when PIN is 4 digits
  useEffect(() => {
    if (pin.length === 4 && !loggingIn) {
      handlePinLogin()
    }
  }, [pin])

  // 🔐 Handle login
  const handlePinLogin = async () => {
    if (loggingIn) return

    if (!selectedUser || pin.length < 4) {
      alert("Enter a valid 4-digit PIN")
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

      // ✅ Real auth redirect
      window.location.href = result.actionLink
    } catch (error: any) {
      console.error(error)
      alert(error.message || "Invalid PIN")
      setPin("")
    }

    setLoggingIn(false)
  }

  // 🔢 Keypad input
  const handleNumberPress = (num: string) => {
    if (pin.length < 4) {
      setPin((prev) => prev + num)
    }
  }

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1))
  }

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
            Tap your name and enter your PIN
          </p>
        </div>

        {/* 👥 Staff Selection */}
        {!selectedUser && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {staffMembers.map((staff) => (
              <button
                key={staff.id}
                onClick={() => setSelectedUser(staff)}
                className="bg-white rounded-3xl shadow-lg p-6 hover:scale-105 transition-all text-center"
              >
                <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-r from-pink-300 to-purple-300 flex items-center justify-center text-white text-2xl font-bold mb-4">
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

        {/* 🔐 PIN Screen */}
        {selectedUser && (
          <div className="max-w-md mx-auto bg-white rounded-3xl shadow-xl p-8 text-center">

            {/* Avatar */}
            <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-r from-pink-300 to-purple-300 flex items-center justify-center text-white text-3xl font-bold mb-5">
              {selectedUser.full_name.charAt(0).toUpperCase()}
            </div>

            <h2 className="text-2xl font-bold text-gray-800">
              {selectedUser.full_name}
            </h2>

            <p className="text-gray-500 mb-6">
              Enter your 4-digit PIN
            </p>

            {/* PIN Display */}
            <div className="flex justify-center gap-3 mb-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center text-2xl font-bold"
                >
                  {pin[i] ? "•" : ""}
                </div>
              ))}
            </div>

            {/* 🔢 Keypad */}
            <div className="grid grid-cols-3 gap-4 max-w-xs mx-auto">

              {[1,2,3,4,5,6,7,8,9].map((num) => (
                <button
                  key={num}
                  onClick={() => handleNumberPress(String(num))}
                  className="p-5 text-xl font-bold rounded-2xl bg-white shadow-md hover:scale-105 transition-all"
                >
                  {num}
                </button>
              ))}

              <div />

              <button
                onClick={() => handleNumberPress("0")}
                className="p-5 text-xl font-bold rounded-2xl bg-white shadow-md hover:scale-105 transition-all"
              >
                0
              </button>

              <button
                onClick={handleDelete}
                className="p-5 text-xl font-bold rounded-2xl bg-red-100 text-red-600 hover:scale-105 transition-all"
              >
                ⌫
              </button>
            </div>

            {/* Switch User */}
            <button
              onClick={() => {
                setSelectedUser(null)
                setPin("")
              }}
              className="mt-6 text-sm text-gray-500 hover:text-gray-700"
            >
              ← Choose another staff member
            </button>
          </div>
        )}
      </div>
    </div>
  )
}