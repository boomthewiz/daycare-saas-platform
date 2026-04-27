"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function SetPinPage() {
  const router = useRouter()

  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSetPin = async () => {
    if (!username || !pin || !confirmPin) {
      alert("Please complete all fields")
      return
    }

    if (pin !== confirmPin) {
      alert("PINs do not match")
      return
    }

    if (pin.length < 4) {
      alert("PIN must be at least 4 digits")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/set-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          pin,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Unable to save PIN")
      }

      alert("PIN created successfully ✨")

      // Redirect staff to quick login page
      router.push("/staff-login")
    } catch (error: any) {
      console.error(error)
      alert(error.message || "Something went wrong")
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6 flex items-center justify-center">
      <div className="w-full max-w-lg">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-800">
            🔐 Create Your PIN
          </h1>

          <p className="text-gray-500 mt-2">
            Set your secure staff PIN for quick login access
          </p>
        </div>

        {/* 🌈 PIN Setup Card */}
        <div className="bg-white rounded-3xl shadow-xl p-8">

          {/* Username */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Username
            </label>

            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="msshirley"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
          </div>

          {/* PIN */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Create PIN
            </label>

            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="w-full text-center text-2xl tracking-widest p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Confirm PIN */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Confirm PIN
            </label>

            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              placeholder="••••"
              className="w-full text-center text-2xl tracking-widest p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
          </div>

          {/* Save Button */}
          <button
            onClick={handleSetPin}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-semibold text-white text-lg shadow-lg bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 hover:scale-105 transition-all"
          >
            {loading
              ? "Saving PIN..."
              : "✨ Save My PIN"}
          </button>

          {/* Footer */}
          <div className="flex justify-center gap-3 mt-8">
            <div className="w-4 h-4 rounded-full bg-pink-300"></div>
            <div className="w-3 h-3 rounded-full bg-blue-300"></div>
            <div className="w-5 h-5 rounded-full bg-yellow-300"></div>
            <div className="w-3 h-3 rounded-full bg-purple-300"></div>
          </div>
        </div>
      </div>
    </div>
  )
}