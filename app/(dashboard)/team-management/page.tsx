"use client"

import { useState } from "react"

export default function TeamManagementPage() {
  // 👥 Form State
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [selectedRole, setSelectedRole] = useState("teacher")
  const [selectedGroup, setSelectedGroup] = useState("")
  const [loading, setLoading] = useState(false)

  // Example groups (replace with Supabase fetch next)
  const groups = [
    { id: "1", name: "Infants" },
    { id: "2", name: "Toddlers" },
    { id: "3", name: "Pre-K" },
    { id: "4", name: "After School" },
  ]

  // ✨ Invite Team Member
  const handleInvite = async () => {
    if (!fullName || !email) {
      alert("Please complete all required fields")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/invite-teacher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          role: selectedRole,
          classroomId: selectedGroup,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Invite failed")
      }

      alert("Team member invited successfully ✨")

      // Reset form
      setFullName("")
      setEmail("")
      setSelectedRole("teacher")
      setSelectedGroup("")
    } catch (error: any) {
      console.error(error)
      alert(error.message || "Something went wrong")
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-2xl mx-auto">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            👥 Team Management
          </h1>

          <p className="text-gray-500 mt-2">
            Invite staff members and manage team access across your organization
          </p>
        </div>

        {/* 🌈 Invite Form */}
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

          {/* Email */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Work Email *
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@business.com"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Role */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Team Role
            </label>

            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            >
              <option value="teacher">Teacher / Educator</option>
              <option value="assistant">Assistant</option>
              <option value="director">Director</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          {/* Group Assignment */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Assign Group (Optional)
            </label>

            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-300"
            >
              <option value="">Choose Group</option>

              {groups.map((group) => (
                <option
                  key={group.id}
                  value={group.id}
                >
                  {group.name}
                </option>
              ))}
            </select>
          </div>

          {/* Bubble Button */}
          <button
            onClick={handleInvite}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-semibold text-white text-lg shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400"
          >
            {loading
              ? "Sending Invite..."
              : "✨ Invite Team Member"}
          </button>

          {/* Footer Bubbles */}
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