"use client"

import { useState } from "react"

export default function InviteTeacherPage() {
  // 👩‍🏫 Form State
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [selectedClassroom, setSelectedClassroom] = useState("")
  const [loading, setLoading] = useState(false)

  // Example classroom list (replace with Supabase fetch next)
  const classrooms = [
    { id: "1", name: "Infants" },
    { id: "2", name: "Toddlers" },
    { id: "3", name: "Pre-K" },
  ]

  // ✨ Invite Teacher Handler
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
          classroomId: selectedClassroom,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Invite failed")
      }

      alert("Teacher invited successfully ✨")

      // Reset form
      setFullName("")
      setEmail("")
      setSelectedClassroom("")
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
        <div className="bg-white rounded-3xl shadow-lg p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            👩‍🏫 Invite Teacher
          </h1>

          <p className="text-gray-500 mt-2">
            Add a new teacher to your daycare team
          </p>
        </div>

        {/* 🌈 Invite Form */}
        <div className="bg-white rounded-3xl shadow-lg p-8">

          {/* Full Name */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Teacher Full Name
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
              Teacher Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teacher@daycare.com"
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Classroom */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Assign Classroom (Optional)
            </label>

            <select
              value={selectedClassroom}
              onChange={(e) => setSelectedClassroom(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            >
              <option value="">Choose Classroom</option>

              {classrooms.map((room) => (
                <option
                  key={room.id}
                  value={room.id}
                >
                  {room.name}
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
              : "✨ Send Teacher Invite"}
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