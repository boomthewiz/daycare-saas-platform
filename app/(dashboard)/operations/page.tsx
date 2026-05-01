"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function OperationsSetupPage() {
  const router = useRouter()

  // 🏫 Group / Classroom Setup
  const [groupName, setGroupName] = useState("")

  // 📋 Workflow Template Setup
  const [templateName, setTemplateName] = useState("")
  const [taskType, setTaskType] = useState("")

  // 🧩 Workflow Categories
  const [workflowCategory, setWorkflowCategory] = useState("")

  // Example starter data (replace with Supabase fetch next)
  const [groups, setGroups] = useState([
    "Infants",
    "Toddlers",
    "Pre-K",
  ])

  const [templates, setTemplates] = useState([
    "Morning Attendance",
    "Lunch Count",
    "Nap Check",
  ])

  const [categories, setCategories] = useState([
    "Classroom Task",
    "Child-Specific Task",
    "Compliance Task",
  ])

  // ➕ Add Group
  const handleAddGroup = () => {
    if (!groupName.trim()) return

    setGroups([...groups, groupName])
    setGroupName("")
  }

  // ➕ Add Template
  const handleAddTemplate = () => {
    if (!templateName.trim()) return

    setTemplates([...templates, templateName])
    setTemplateName("")
    setTaskType("")
  }

  // ➕ Add Category
  const handleAddCategory = () => {
    if (!workflowCategory.trim()) return

    setCategories([...categories, workflowCategory])
    setWorkflowCategory("")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-5xl mx-auto">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            ⚙️ Operations Setup
          </h1>

          <p className="text-gray-500 mt-2">
            Configure your workflow system for teams, recurring tasks, and daily operations
          </p>
        </div>

        {/* 🏫 Groups Section */}
        <div className="bg-white rounded-3xl shadow-lg p-8 mb-6">
          <h2 className="text-2xl font-bold mb-4">
            🏫 Groups / Classrooms
          </h2>

          <p className="text-gray-500 mb-5">
            Create the spaces where your daily operations happen
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Example: Infants"
              className="flex-1 p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-300"
            />

            <button
              onClick={handleAddGroup}
              className="px-6 py-4 rounded-2xl bg-gradient-to-r from-pink-400 to-purple-400 text-white font-semibold shadow-lg hover:scale-105 transition-all"
            >
              ➕ Add Group
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {groups.map((group, index) => (
              <div
                key={index}
                className="p-4 bg-pink-50 rounded-2xl text-center font-medium"
              >
                {group}
              </div>
            ))}
          </div>
        </div>

        {/* 📋 Workflow Templates */}
        <div className="bg-white rounded-3xl shadow-lg p-8 mb-6">
          <h2 className="text-2xl font-bold mb-4">
            📋 Workflow Templates
          </h2>

          <p className="text-gray-500 mb-5">
            Create repeatable tasks your staff completes daily
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Example: Morning Attendance"
              className="p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />

            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              className="p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            >
              <option value="">Select Task Type</option>
              <option value="daily">Daily</option>
              <option value="compliance">Compliance</option>
              <option value="child-specific">Individual</option>
            </select>
          </div>

          <button
            onClick={handleAddTemplate}
            className="px-6 py-4 rounded-2xl bg-gradient-to-r from-blue-400 to-cyan-400 text-white font-semibold shadow-lg hover:scale-105 transition-all mb-5"
          >
            ✨ Add Workflow Template
          </button>

          <div className="space-y-3">
            {templates.map((template, index) => (
              <div
                key={index}
                className="p-4 bg-blue-50 rounded-2xl font-medium"
              >
                {template}
              </div>
            ))}
          </div>
        </div>

        {/* 🧩 Workflow Categories */}
        <div className="bg-white rounded-3xl shadow-lg p-8">
          <h2 className="text-2xl font-bold mb-4">
            🧩 Workflow Categories
          </h2>

          <p className="text-gray-500 mb-5">
            Organize operations by workflow type and reporting structure
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <input
              type="text"
              value={workflowCategory}
              onChange={(e) => setWorkflowCategory(e.target.value)}
              placeholder="Example: Health & Safety"
              className="flex-1 p-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-300"
            />

            <button
              onClick={handleAddCategory}
              className="px-6 py-4 rounded-2xl bg-gradient-to-r from-purple-400 to-pink-400 text-white font-semibold shadow-lg hover:scale-105 transition-all"
            >
              ➕ Add Category
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {categories.map((category, index) => (
              <div
                key={index}
                className="p-4 bg-purple-50 rounded-2xl text-center font-medium"
              >
                {category}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}