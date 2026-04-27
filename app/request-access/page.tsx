"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function AccessRequestsPage() {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // 🔄 Fetch owner access requests
  const fetchRequests = async () => {
    const { data, error } = await supabase
      .from("owner_requests")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Fetch requests error:", error)
    }

    setRequests(data || [])
    setLoading(false)
  }

  // ✅ Update request status
  const updateStatus = async (
    id: string,
    status: "approved" | "rejected"
  ) => {
    const { error } = await supabase
      .from("owner_requests")
      .update({ status })
      .eq("id", id)

    if (error) {
      console.error("Status update error:", error)
      alert("Unable to update request")
      return
    }

    fetchRequests()
  }

  useEffect(() => {
    fetchRequests()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 flex items-center justify-center">
        <p className="text-lg text-gray-500">
          Loading access requests...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-5xl mx-auto">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            ✨ Access Requests
          </h1>

          <p className="text-gray-500 mt-2">
            Review and manage new organization owner requests
          </p>
        </div>

        {/* Empty State */}
        {requests.length === 0 && (
          <div className="bg-white rounded-3xl shadow-lg p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">
              🎉 No Pending Requests
            </h2>

            <p className="text-gray-500">
              New owner access requests will appear here
            </p>
          </div>
        )}

        {/* Requests List */}
        {requests.length > 0 && (
          <div className="space-y-5">
            {requests.map((request) => (
              <div
                key={request.id}
                className="bg-white rounded-3xl shadow-lg p-6"
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">

                  {/* Left Side */}
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-gray-800">
                      {request.daycare_name}
                    </h2>

                    <p className="text-gray-600">
                      👤 {request.full_name}
                    </p>

                    <p className="text-gray-600">
                      📧 {request.email}
                    </p>

                    {request.phone && (
                      <p className="text-gray-600">
                        📞 {request.phone}
                      </p>
                    )}

                    {request.staff_size && (
                      <p className="text-gray-600">
                        👥 Staff Size: {request.staff_size}
                      </p>
                    )}

                    {request.message && (
                      <div className="mt-3 p-4 rounded-2xl bg-gray-50">
                        <p className="text-sm text-gray-600">
                          {request.message}
                        </p>
                      </div>
                    )}

                    <div className="mt-3">
                      <span
                        className={`px-4 py-2 rounded-full text-sm font-medium ${
                          request.status === "approved"
                            ? "bg-green-100 text-green-700"
                            : request.status === "rejected"
                            ? "bg-red-100 text-red-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {request.status}
                      </span>
                    </div>
                  </div>

                  {/* Right Side */}
                  {request.status === "pending" && (
                    <div className="flex flex-col sm:flex-row gap-3">

                      <button
                        onClick={() =>
                          updateStatus(request.id, "approved")
                        }
                        className="px-6 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-green-400 to-emerald-400 shadow-lg hover:scale-105 transition-all"
                      >
                        ✅ Approve
                      </button>

                      <button
                        onClick={() =>
                          updateStatus(request.id, "rejected")
                        }
                        className="px-6 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-red-400 to-pink-400 shadow-lg hover:scale-105 transition-all"
                      >
                        ❌ Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}