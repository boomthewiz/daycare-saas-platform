"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"

export default function LoginPage() {
  const [email, setEmail] = useState("")
    const [selectedRole, setSelectedRole] = useState<
    "teacher" | "owner"
  >("teacher")
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email) {
      alert("Please enter your email")
      return
    }

    setLoading(true)

    const redirectUrl =
      selectedRole === "owner"
        ? "https://www.rejoyceapp.com/dashboard"
        : "https://www.rejoyceapp.com/dashboard"

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          role: selectedRole,
        },
      },
    })

    setLoading(false)

    if (error) {
      console.error(error)
      alert("Login failed")
    } else {
      alert(
        `Magic login link sent for ${selectedRole} access ✨`
      )
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/90 backdrop-blur-lg rounded-3xl shadow-xl p-8 border border-white">

        {/* 🌈 Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🫧</div>

          <h1 className="text-3xl font-bold text-gray-800">
            Welcome Back
          </h1>

          <p className="text-gray-500 mt-2">
            Choose your role and login to continue
          </p>
        </div>

        {/* 🎯 Role Selection */}
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-600 mb-3">
            I am logging in as:
          </p>

          <div className="grid grid-cols-2 gap-3">

            {/* 👩‍🏫 Teacher */}
            <button
              onClick={() => setSelectedRole("teacher")}
              className={`p-4 rounded-2xl font-semibold transition-all duration-300 hover:scale-105 ${
                selectedRole === "teacher"
                  ? "bg-gradient-to-r from-blue-400 to-cyan-400 text-white shadow-lg"
                  : "bg-white border border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              👩‍🏫 Teacher
            </button>

            {/* 👑 Owner */}
            <button
              onClick={() => setSelectedRole("owner")}
              className={`p-4 rounded-2xl font-semibold transition-all duration-300 hover:scale-105 ${
                selectedRole === "owner"
                  ? "bg-gradient-to-r from-pink-400 to-purple-400 text-white shadow-lg"
                  : "bg-white border border-gray-200 text-gray-700 hover:bg-pink-50"
              }`}
            >
              👑 Owner
            </button>
          </div>
        </div>

        {/* 📧 Email Input */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-600 mb-2">
            Email Address
          </label>

          <input
            type="email"
            placeholder={
              selectedRole === "owner"
                ? "owner@daycare.com"
                : "teacher@daycare.com"
            }
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300 transition"
          />
        </div>

        {/* 🫧 Bubble Login Button */}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400"
        >
          {loading
            ? "Sending Magic Link..."
            : `✨ Login as ${
                selectedRole === "owner"
                  ? "Owner"
                  : "Teacher"
              }`}
        </button>

        {/* 🌟 Footer Helper */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Safe, simple, and tablet-friendly access
          </p>
        </div>

        {/* 🎈 Decorative Bubble Footer */}
        <div className="flex justify-center gap-3 mt-8">
          <div className="w-4 h-4 rounded-full bg-pink-300"></div>
          <div className="w-3 h-3 rounded-full bg-blue-300"></div>
          <div className="w-5 h-5 rounded-full bg-yellow-300"></div>
          <div className="w-3 h-3 rounded-full bg-purple-300"></div>
        </div>
      </div>
    </div>
  )
}