"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getPinStatus } from "@/lib/pin-status"

export default function SetPinPage() {
  const router = useRouter()

  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)

  // 🔐 Ensure user is logged in + check if PIN exists
  useEffect(() => {
    const checkUser = async () => {
      try {
        const status = await getPinStatus()
        if (!status) {
          router.replace("/login")
          return
        }
        if (status.hasPin && !status.resetRequired) {
          router.replace("/dashboard")
          return
        }
        setChecking(false)
      } catch (error) {
        setAccountError(error instanceof Error ? error.message : "Unable to check your account.")
      }
    }

    checkUser()
  }, [router])

  const handleSetPin = async () => {
    if (loading) return

    if (!/^\d{4}$/.test(pin)) {
      alert("PIN must be 4 digits")
      return
    }

    if (pin !== confirmPin) {
      alert("PINs do not match")
      return
    }

    setLoading(true)

    try {
      // 🔐 Get session
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error("Session expired. Please log in again.")
      }

      // ✅ FIXED: store response
      const response = await fetch("/api/set-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ pin }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to set PIN")
      }

      alert("PIN set successfully ✨")

      router.push("/dashboard")
    } catch (error) {
      alert(error instanceof Error ? error.message : "Something went wrong")
    }

    setLoading(false)
  }

  if (accountError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p role="alert">{accountError}</p>
        <button onClick={() => window.location.reload()}>Try again</button>
        <a href="/login">Return to sign in</a>
      </div>
    )
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100">
        <p className="text-gray-500 text-lg">
          Preparing your account...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">

        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          🔐 Create Your PIN
        </h1>

        <p className="text-gray-500 mb-6">
          This PIN will be used for quick staff login
        </p>

        {/* PIN Input */}
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, ""))
          }
          placeholder="Enter PIN"
          className="w-full text-center text-2xl p-4 rounded-2xl border border-gray-200 mb-4"
        />

        {/* Confirm PIN */}
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={confirmPin}
          onChange={(e) =>
            setConfirmPin(e.target.value.replace(/\D/g, ""))
          }
          placeholder="Confirm PIN"
          className="w-full text-center text-2xl p-4 rounded-2xl border border-gray-200 mb-6"
        />

        <button
          onClick={handleSetPin}
          disabled={loading}
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 hover:scale-105 transition-all"
        >
          {loading ? "Saving..." : "✨ Save PIN"}
        </button>

        <div className="flex justify-center gap-3 mt-8">
          <div className="w-4 h-4 rounded-full bg-pink-300"></div>
          <div className="w-3 h-3 rounded-full bg-blue-300"></div>
          <div className="w-5 h-5 rounded-full bg-yellow-300"></div>
        </div>
      </div>
    </div>
  )
}
