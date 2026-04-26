"use client"

import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"

export default function TemplatesPage() {
  const [title, setTitle] = useState("")
  const [type, setType] = useState("classroom")
  const [frequency, setFrequency] = useState("daily")
  const [interval, setInterval] = useState(60)
  const [classroomId, setClassroomId] = useState("")
  const [classrooms, setClassrooms] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<any>(null)

  // 🏫 Fetch classrooms
  const fetchClassrooms = async () => {
    const { data } = await supabase
      .from("classrooms")
      .select("id, name")

    setClassrooms(data || [])
  }

  // 📋 Fetch templates
  const fetchTemplates = async () => {
    const { data } = await supabase
      .from("task_templates")
      .select("*")
      .order("created_at", { ascending: false })

    setTemplates(data || [])
  }

  useEffect(() => {
    fetchClassrooms()
    fetchTemplates()
  }, [])

  // 💾 Create template
  const handleSubmit = async () => {
    if (!title) return alert("Task title required")

    setLoading(true)

    const { error } = await supabase.from("task_templates").insert({
      title,
      type,
      frequency,
      interval_minutes: frequency === "hourly" ? interval : null,
      classroom_id: type === "classroom" ? classroomId : null,
      active: true,
    })

    setLoading(false)

    if (error) {
      console.error(error)
      alert("Error creating template")
    } else {
      setTitle("")
      setInterval(60)
      setClassroomId("")
      fetchTemplates()
    }
  }

  // 🔁 Toggle active
  const toggleActive = async (template: any) => {
    await supabase
      .from("task_templates")
      .update({ active: !template.active })
      .eq("id", template.id)

    fetchTemplates()
  }

  // 🗑️ Delete
  const deleteTemplate = async (id: string) => {
    if (!confirm("Delete this template?")) return

    await supabase
      .from("task_templates")
      .delete()
      .eq("id", id)

    fetchTemplates()
  }

  // ✏️ Open edit
  const openEdit = (template: any) => {
    setEditingTemplate(template)
  }

  // ❌ Close edit
  const closeEdit = () => {
    setEditingTemplate(null)
  }

  // 💾 Update template
  const updateTemplate = async () => {
    if (!editingTemplate.title) return alert("Title required")

    const { error } = await supabase
      .from("task_templates")
      .update({
        title: editingTemplate.title,
        type: editingTemplate.type,
        frequency: editingTemplate.frequency,
        interval_minutes:
          editingTemplate.frequency === "hourly"
            ? editingTemplate.interval_minutes
            : null,
        classroom_id:
          editingTemplate.type === "classroom"
            ? editingTemplate.classroom_id
            : null,
      })
      .eq("id", editingTemplate.id)

    if (error) {
      console.error(error)
      alert("Error updating template")
    } else {
      closeEdit()
      fetchTemplates()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">

        {/* 🧠 Header */}
        <h1 className="text-2xl font-bold mb-4">
          Task Templates
        </h1>

        {/* 🛠️ CREATE FORM */}
        <div className="bg-white p-4 rounded-lg shadow mb-8">
          <h2 className="text-lg font-semibold mb-3">
            Create Template
          </h2>

          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            className="w-full p-2 border rounded mb-3"
          />

          {/* Type */}
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full p-2 border rounded mb-3"
          >
            <option value="classroom">Classroom</option>
            <option value="child">Child</option>
          </select>

          {/* Classroom */}
          {type === "classroom" && (
            <select
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              className="w-full p-2 border rounded mb-3"
            >
              <option value="">Select classroom</option>
              {classrooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          )}

          {/* Frequency */}
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-full p-2 border rounded mb-3"
          >
            <option value="daily">Daily</option>
            <option value="hourly">Hourly</option>
          </select>

          {/* Interval */}
          {frequency === "hourly" && (
            <input
              type="number"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              className="w-full p-2 border rounded mb-3"
            />
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg"
          >
            {loading ? "Creating..." : "Create Template"}
          </button>
        </div>

        {/* 📋 TEMPLATE LIST */}
        <div>
          <h2 className="text-xl font-semibold mb-3">
            Existing Templates
          </h2>

          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="p-4 bg-white rounded-lg shadow flex flex-col sm:flex-row sm:justify-between gap-3"
              >
                {/* Info */}
                <div>
                  <p className="font-medium">{template.title}</p>
                  <p className="text-sm text-gray-400">
                    {template.type} • {template.frequency}
                  </p>

                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      template.active
                        ? "bg-green-100 text-green-600"
                        : "bg-gray-200"
                    }`}
                  >
                    {template.active ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => toggleActive(template)}
                    className="px-3 py-2 bg-gray-200 rounded"
                  >
                    Toggle
                  </button>

                  <button
                    onClick={() => openEdit(template)}
                    className="px-3 py-2 bg-blue-500 text-white rounded"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => deleteTemplate(template.id)}
                    className="px-3 py-2 bg-red-500 text-white rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ✏️ EDIT MODAL */}
        {editingTemplate && (
          <div
            className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
            onClick={closeEdit}
          >
            <div
              className="bg-white p-6 rounded-lg w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-semibold mb-4">
                Edit Template
              </h2>

              {/* Title */}
              <input
                type="text"
                value={editingTemplate.title}
                onChange={(e) =>
                  setEditingTemplate({
                    ...editingTemplate,
                    title: e.target.value,
                  })
                }
                className="w-full p-2 border rounded mb-3"
              />

              {/* Type */}
              <select
                value={editingTemplate.type}
                onChange={(e) =>
                  setEditingTemplate({
                    ...editingTemplate,
                    type: e.target.value,
                  })
                }
                className="w-full p-2 border rounded mb-3"
              >
                <option value="classroom">Classroom</option>
                <option value="child">Child</option>
              </select>

              {/* Classroom */}
              {editingTemplate.type === "classroom" && (
                <select
                  value={editingTemplate.classroom_id || ""}
                  onChange={(e) =>
                    setEditingTemplate({
                      ...editingTemplate,
                      classroom_id: e.target.value,
                    })
                  }
                  className="w-full p-2 border rounded mb-3"
                >
                  <option value="">Select classroom</option>
                  {classrooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Frequency */}
              <select
                value={editingTemplate.frequency}
                onChange={(e) =>
                  setEditingTemplate({
                    ...editingTemplate,
                    frequency: e.target.value,
                  })
                }
                className="w-full p-2 border rounded mb-3"
              >
                <option value="daily">Daily</option>
                <option value="hourly">Hourly</option>
              </select>

              {/* Interval */}
              {editingTemplate.frequency === "hourly" && (
                <input
                  type="number"
                  value={editingTemplate.interval_minutes || 60}
                  onChange={(e) =>
                    setEditingTemplate({
                      ...editingTemplate,
                      interval_minutes: Number(e.target.value),
                    })
                  }
                  className="w-full p-2 border rounded mb-3"
                />
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={closeEdit}
                  className="px-4 py-2 bg-gray-200 rounded"
                >
                  Cancel
                </button>

                <button
                  onClick={updateTemplate}
                  className="px-4 py-2 bg-blue-600 text-white rounded"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}