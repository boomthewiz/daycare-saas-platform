"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [role, setRole] = useState("")

  // 🔄 Fetch current user profile
  const fetchProfile = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single()

    if (error) {
      console.error("Profile fetch error:", error)
    }

    if (data) {
      setProfile(data)
      setFullName(data.full_name || "")
      setEmail(user.email || "")
      setPhone(data.phone || "")
      setRole(data.role || "teacher")
    }

    setLoading(false)
  }

  // 💾 Save profile updates
  const handleSave = async () => {
    if (!profile?.id) return

    setSaving(true)

    const { error } = await supabase
      .from("users")
      .update({
        full_name: fullName,
        phone,
      })
      .eq("id", profile.id)

    setSaving(false)

    if (error) {
      console.error("Save profile error:", error)
      alert("Unable to save profile")
      return
    }

    alert("Profile updated successfully ✨")
    fetchProfile()
  }

  useEffect(() => {
    fetchProfile()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 flex items-center justify-center">
        <p className="text-lg text-gray-500">
          Loading profile...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-3xl mx-auto">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            👤 My Profile
          </h1>

          <p className="text-gray-500 mt-2">
            Manage your personal account settings and contact details
          </p>
        </div>

        {/* 🌈 Profile Card */}
        <div className="bg-white rounded-3xl shadow-xl p-8">

          {/* Avatar Bubble */}
          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 rounded-full bg-gradient-to-r from-pink-300 to-purple-300 flex items-center justify-center text-white text-3xl font-bold shadow-lg">
              {fullName
                ? fullName.charAt(0).toUpperCase()
                : "U"}
            </div>
          </div>

          {/* Full Name */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Full Name
            </label>

            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
          </div>

          {/* Email */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Email Address
            </label>

            <input
              type="email"
              value={email}
              disabled
              className="w-full p-4 rounded-2xl border border-gray-100 bg-gray-50 text-gray-500"
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
              className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Role */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-600 mb-2">
              Role
            </label>

            <input
              type="text"
              value={role}
              disabled
              className="w-full p-4 rounded-2xl border border-gray-100 bg-gray-50 text-gray-500 capitalize"
            />
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 rounded-2xl font-semibold text-white text-lg shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400"
          >
            {saving
              ? "Saving..."
              : "✨ Save Profile"}
          </button>

          {/* Bubble Footer */}
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