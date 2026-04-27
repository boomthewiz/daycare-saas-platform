"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"

export default function RequestAccessPage() {
  const [fullName, setFullName] = useState("")
  const [organizationName, setOrganizationName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [organizationType, setOrganizationType] = useState("")
  const [staffSize, setStaffSize] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!fullName || !organizationName || !email) {
      alert("Please complete all required fields")
      return
    }

    setLoading(true)

    const { error } = await supabase
      .from("owner_requests")
      .insert([
        {
          full_name: fullName,
          daycare_name: organizationName,
          email,
          phone,
          staff_size: staffSize,
          message: `
Organization Type: ${organizationType}

${message}
          `,
          status: "pending",
        },
      ])

    setLoading(false)

    if (error) {
      console.error(error)
      alert("Something went wrong. Please try again.")
      return
    }

    alert(
      "Request submitted successfully ✨ We'll review your organization and contact you soon."
    )

    setFullName("")
    setOrganizationName("")
    setEmail("")
    setPhone("")
    setOrganizationType("")
    setStaffSize("")
    setMessage("")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            ✨ Request Access
          </h1>

          <p className="text-gray-500 mt-2">
            Tell us about your organization and request owner approval for ReJoyce Workflow System
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-3xl shadow-xl p-8">

          <div className="mb-5">
            <label className="block text-sm font-medium mb-2">
              Your Full Name *
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full p-4 rounded-2xl border border-gray-200"
            />
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium mb-2">
              Organization Name *
            </label>
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Little Learners Academy"
              className="w-full p-4 rounded-2xl border border-gray-200"
            />
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium mb-2">
              Business Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@business.com"
              className="w-full p-4 rounded-2xl border border-gray-200"
            />
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium mb-2">
              Contact Phone
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="w-full p-4 rounded-2xl border border-gray-200"
            />
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium mb-2">
              Organization Type
            </label>
            <select
              value={organizationType}
              onChange={(e) => setOrganizationType(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200"
            >
              <option value="">Select type</option>
              <option value="Daycare">Daycare</option>
              <option value="School">School</option>
              <option value="Assisted Living">Assisted Living</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium mb-2">
              Team Size
            </label>
            <select
              value={staffSize}
              onChange={(e) => setStaffSize(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200"
            >
              <option value="">Select size</option>
              <option value="1-5">1–5</option>
              <option value="6-15">6–15</option>
              <option value="16-30">16–30</option>
              <option value="30+">30+</option>
            </select>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">
              Additional Notes
            </label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us a little about your workflow needs..."
              className="w-full p-4 rounded-2xl border border-gray-200"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-semibold text-white text-lg bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 shadow-lg hover:scale-105 transition-all"
          >
            {loading ? "Submitting..." : "✨ Submit Request"}
          </button>
        </div>
      </div>
    </div>
  )
}