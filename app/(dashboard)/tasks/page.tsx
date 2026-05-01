"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const today = new Date().toISOString().split("T")[0]

  // 🔄 Fetch today's tasks
  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select(`
        *,
        classrooms(name),
        children(name)
      `)
      .eq("generated_date", today)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Fetch tasks error:", error)
    }

    setTasks(data || [])
    setLoading(false)
  }

  // ✅ Toggle task completion
  const toggleComplete = async (task: any) => {
    const { error } = await supabase
      .from("tasks")
      .update({
        completed: !task.completed,
      })
      .eq("id", task.id)

    if (error) {
      console.error("Toggle complete error:", error)
      alert("Unable to update task")
      return
    }

    fetchTasks()
  }

  useEffect(() => {
    fetchTasks()

    // 🔴 Realtime updates
    const channel = supabase
      .channel("tasks-page-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
        },
        () => fetchTasks()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 flex items-center justify-center">
        <p className="text-lg text-gray-500">
          Loading today’s tasks...
        </p>
      </div>
    )
  }

  const completedCount = tasks.filter(
    (task) => task.completed
  ).length

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-5xl mx-auto">

        {/* 🫧 Header */}
        <div className="bg-white rounded-3xl shadow-xl p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            📋 My Tasks
          </h1>

          <p className="text-gray-500 mt-2">
            Stay on top of today’s workflow and team responsibilities
          </p>
        </div>

        {/* 📊 Task Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-3xl shadow-lg p-6">
            <p className="text-sm text-gray-500">
              Total Tasks
            </p>
            <p className="text-3xl font-bold text-gray-800">
              {tasks.length}
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-lg p-6">
            <p className="text-sm text-gray-500">
              Completed
            </p>
            <p className="text-3xl font-bold text-gray-800">
              {completedCount}
            </p>
          </div>
        </div>

        {/* Empty State */}
        {tasks.length === 0 && (
          <div className="bg-white rounded-3xl shadow-lg p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">
              🎉 No Tasks Today
            </h2>

            <p className="text-gray-500">
              Your workflow is clear for today
            </p>
          </div>
        )}

        {/* Task List */}
        {tasks.length > 0 && (
          <div className="space-y-4">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="bg-white rounded-3xl shadow-lg p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                {/* Left Side */}
                <div>
                  <h2 className="text-lg font-bold text-gray-800">
                    {task.title}
                  </h2>

                  <div className="mt-2 space-y-1">
                    {task.classrooms?.name && (
                      <p className="text-sm text-gray-500">
                        🏫 {task.classrooms.name}
                      </p>
                    )}

                    {task.children?.name && (
                      <p className="text-sm text-gray-500">
                        👶 {task.children.name}
                      </p>
                    )}

                    <p className="text-sm text-gray-400">
                      {task.completed
                        ? "Completed"
                        : "Pending"}
                    </p>
                  </div>
                </div>

                {/* Right Side */}
                <button
                  onClick={() => toggleComplete(task)}
                  className={`px-6 py-3 rounded-2xl font-semibold text-white shadow-lg transition-all duration-300 hover:scale-105 ${
                    task.completed
                      ? "bg-gradient-to-r from-green-400 to-emerald-400"
                      : "bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400"
                  }`}
                >
                  {task.completed
                    ? "✅ Done"
                    : "✨ Complete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}