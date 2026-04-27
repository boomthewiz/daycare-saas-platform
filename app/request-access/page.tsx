"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"

export default function RequestAccessPage() {
  const [fullName, setFullName] = useState("")
  const [daycareName, setDaycareName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [staffSize, setStaffSize] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!fullName || !daycareName || !email) {
      alert("Please complete all required fields")
      return
    }

    setLoading(true)

    const { error } = await supabase
      .from("owner_requests")
      .insert([
        {
          full_name: fullName,
          daycare_name: daycareName,
          email,
          phone,
          staff_size: staffSize,
          message,
          status: "pending",
        },
      ])

    setLoading(false)

    if (error) {
      console.error(error)
      alert("Something went wrong. Please try again.")
      return
    }

    alert("Request submitted successfully ✨ We’ll review your daycare and contact you soon.")

    setFullName("")
    setDaycareName("")
    setEmail("")
    setPhone("")
    setStaffSize("")
    setMessage("")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-2xl mx-auto">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            ✨ Request Owner Access
          </h1>

          <p className="text-gray-500 mt-2">
            Register your daycare and request approval to join ReJoyce
          </p>
        </div>

        {/* 🌈 Form */}
        <div className="bg-white rounded-3xl shadow-xl p-8">

          {/* Full Name */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Full Name *
            </label>

            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
          </div>

          {/* Daycare Name */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Daycare Name *
            </label>

            <input
              type="text"
              value={daycareName}
              onChange={(e) => setDaycareName(e.target.value)}
              placeholder="Little Learners Academy"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Email */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Business Email *
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@daycare.com"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            />
          </div>

          {/* Phone */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Contact Phone
            </label>

            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
          </div>

          {/* Staff Size */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Staff Size
            </label>

            <select
              value={staffSize}
              onChange={(e) => setStaffSize(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300"
            >
              <option value="">Select amount</option>
              <option value="1-5">1–5</option>
              <option value="6-15">6–15</option>
              <option value="16-30">16–30</option>
              <option value="30+">30+</option>
            </select>
          </div>

          {/* Message */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Additional Notes
            </label>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us a little about your daycare..."
              rows={4}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-semibold text-white text-lg shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400"
          >
            {loading
              ? "Submitting..."
              : "✨ Request Access"}
          </button>

          {/* 🎈 Bubble Footer */}
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