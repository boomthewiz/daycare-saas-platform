"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function OwnerOnboardingPage() {
  const router = useRouter()

  // 👑 Owner onboarding form state
  const [daycareName, setDaycareName] = useState("")
  const [classroomCount, setClassroomCount] = useState("")
  const [staffSize, setStaffSize] = useState("")
  const [phone, setPhone] = useState("")
  const [billingEmail, setBillingEmail] = useState("")
  const [loading, setLoading] = useState(false)

  // ✨ Continue to subscription setup
  const handleContinue = async () => {
    if (!daycareName || !billingEmail) {
      alert("Please complete the required fields")
      return
    }

    setLoading(true)

    // Later:
    // Save owner onboarding data to Supabase here

    // Next step:
    // Redirect to Stripe checkout route
    router.push("/dashboard")

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-2xl mx-auto">

        {/* 🫧 Header Card */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            👑 Welcome, Owner!
          </h1>

          <p className="text-gray-500 mt-2">
            Let’s set up your daycare in under 60 seconds ✨
          </p>
        </div>

        {/* 🌈 Onboarding Form */}
        <div className="bg-white rounded-3xl shadow-xl p-8">

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
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
          </div>

          {/* Classroom Count */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Number of Classrooms
            </label>

            <select
              value={classroomCount}
              onChange={(e) => setClassroomCount(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">Select amount</option>
              <option value="1-3">1–3</option>
              <option value="4-7">4–7</option>
              <option value="8-15">8–15</option>
              <option value="15+">15+</option>
            </select>
          </div>

          {/* Staff Size */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Staff Size
            </label>

            <select
              value={staffSize}
              onChange={(e) => setStaffSize(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            >
              <option value="">Select amount</option>
              <option value="1-5">1–5</option>
              <option value="6-15">6–15</option>
              <option value="16-30">16–30</option>
              <option value="30+">30+</option>
            </select>
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

          {/* Billing Email */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Billing Contact Email *
            </label>

            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="owner@daycare.com"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
          </div>

          {/* ✨ Continue Button */}
          <button
            onClick={handleContinue}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-semibold text-white text-lg shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400"
          >
            {loading
              ? "Saving Setup..."
              : "✨ Continue to Subscription"}
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