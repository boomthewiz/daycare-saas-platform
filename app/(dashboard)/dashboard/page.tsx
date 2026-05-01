"use client"

import { useEffect, useState } from "react"
import { supabase } from "../../../lib/supabase"

export default function DashboardPage() {

  // 📋 Main task state
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // 🏫 Classroom filtering
  const [selectedClassroom, setSelectedClassroom] = useState("all")
  const [classrooms, setClassrooms] = useState<any[]>([])

  const today = new Date().toISOString().split("T")[0]

  // 🏫 Fetch classrooms
  const fetchClassrooms = async () => {
    const { data, error } = await supabase
      .from("classrooms")
      .select("id, name")
      .order("name", { ascending: true })

    if (!error) {
      setClassrooms(data || [])
    }
  }

  // 🔄 Fetch tasks
  const fetchTasks = async () => {
    setLoading(true)

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

  // 🔁 Load + Realtime
  useEffect(() => {
    fetchTasks()
    fetchClassrooms()

    const channel = supabase
      .channel("tasks-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
        },
        () => {
          fetchTasks()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // ✅ Toggle completion
  const toggleComplete = async (task: any) => {
    const { error } = await supabase
      .from("tasks")
      .update({ completed: !task.completed })
      .eq("id", task.id)

    if (error) {
      console.error("Toggle error:", error)
      return
    }

    fetchTasks()
  }

  // 🎯 Filtering
  const filteredTasks =
    selectedClassroom === "all"
      ? tasks
      : tasks.filter(
          (task) => task.classroom_id === selectedClassroom
        )

  const classroomTasks = filteredTasks.filter(
    (task) => task.classroom_id
  )

  const childTasks = filteredTasks.filter(
    (task) => task.child_id
  )

  // ⏳ Loading state ONLY for data
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-lg">
          Loading tasks...
        </p>
      </div>
    )
  }

  return (
    <div className="pb-20">
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">

        {/* 📊 Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-white rounded-lg shadow">
            <p className="text-sm text-gray-500">Total Tasks</p>
            <p className="text-2xl font-bold">{tasks.length}</p>
          </div>

          <div className="p-4 bg-white rounded-lg shadow">
            <p className="text-sm text-gray-500">Completed</p>
            <p className="text-2xl font-bold">
              {tasks.filter((t) => t.completed).length}
            </p>
          </div>
        </div>

        {/* 🏫 Classrooms */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">
            🏫 Classrooms
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {classrooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setSelectedClassroom(room.id)}
                className={`p-4 rounded-3xl shadow-md transition-all hover:scale-105 ${
                  selectedClassroom === room.id
                    ? "bg-gradient-to-r from-pink-400 to-purple-400 text-white"
                    : "bg-white"
                }`}
              >
                {room.name}
              </button>
            ))}
          </div>
        </div>

        {/* 🎉 Empty State */}
        {tasks.length === 0 && (
          <div className="p-8 bg-white rounded-3xl shadow-lg text-center">
            <h2 className="text-2xl font-bold mb-2">
              🎉 Welcome to ReJoyce
            </h2>
            <p className="text-gray-500 mb-6">
              Let’s create your first task
            </p>
          </div>
        )}

        {/* 🏫 Classroom Tasks */}
        {classroomTasks.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-2">
              🏫 Classroom Tasks ({classroomTasks.length})
            </h2>

            <div className="space-y-3">
              {classroomTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 bg-white rounded-xl shadow flex justify-between"
                >
                  <div>
                    <p className="font-semibold">{task.title}</p>
                    <p className="text-sm text-gray-400">
                      {task.classrooms?.name || "No classroom"}
                    </p>
                  </div>

                  <button
                    onClick={() => toggleComplete(task)}
                    className={`px-4 py-2 rounded ${
                      task.completed
                        ? "bg-green-500 text-white"
                        : "bg-gray-200"
                    }`}
                  >
                    {task.completed ? "Done" : "Complete"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 👶 Child Tasks */}
        {childTasks.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-2">
              👶 Child Tasks ({childTasks.length})
            </h2>

            <div className="space-y-3">
              {childTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 bg-white rounded-xl shadow flex justify-between"
                >
                  <div>
                    <p className="font-semibold">{task.title}</p>
                    <p className="text-sm text-gray-400">
                      {task.children?.name || "No child"}
                    </p>
                  </div>

                  <button
                    onClick={() => toggleComplete(task)}
                    className={`px-4 py-2 rounded ${
                      task.completed
                        ? "bg-green-500 text-white"
                        : "bg-gray-200"
                    }`}
                  >
                    {task.completed ? "Done" : "Complete"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}