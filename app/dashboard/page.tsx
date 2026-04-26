"use client"

import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"

export default function DashboardPage() {
  // 📋 Main task state
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // 🏫 Classroom filtering
  const [selectedClassroom, setSelectedClassroom] = useState("all")
  const [classrooms, setClassrooms] = useState<any[]>([])

  // 📅 Today's date for generated tasks
  const today = new Date().toISOString().split("T")[0]

  // 🏫 Fetch classrooms for dropdown filter
  const fetchClassrooms = async () => {
    const { data, error } = await supabase
      .from("classrooms")
      .select("id, name")
      .order("name", { ascending: true })

    console.log("CLASSROOMS:", data)
    console.log("CLASSROOM ERROR:", error)

    if (!error) {
      setClassrooms(data || [])
    }
  }

  // 🔄 Fetch today's tasks
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

    console.log("TASK DATA:", data)
    console.log("TASK ERROR:", error)

    if (error) {
      console.error("Fetch tasks error:", error)
    }

    setTasks(data || [])
    setLoading(false)
  }

  // 📡 Initial load + real-time subscription
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
          console.log("Realtime update detected")
          fetchTasks()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

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
      return
    }

    fetchTasks()
  }

  // 🎯 Apply classroom filtering
  const filteredTasks =
    selectedClassroom === "all"
      ? tasks
      : tasks.filter(
          (task) => task.classroom_id === selectedClassroom
        )

  // 🏫 Split classroom tasks
  const classroomTasks = filteredTasks.filter(
    (task) => task.classroom_id
  )

  // 👶 Split child tasks
  const childTasks = filteredTasks.filter(
    (task) => task.child_id
  )

  // ⏳ Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-lg">
          Loading tasks...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">

        {/* 🧠 Page Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold">
            📋 Today’s Tasks
          </h1>
          <p className="text-gray-500">
            Track and complete daily classroom activities
          </p>
        </div>

        {/* 📊 Dashboard Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-white rounded-lg shadow">
            <p className="text-sm text-gray-500">
              Total Tasks
            </p>
            <p className="text-2xl font-bold">
              {tasks.length}
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg shadow">
            <p className="text-sm text-gray-500">
              Completed
            </p>
            <p className="text-2xl font-bold">
              {tasks.filter((task) => task.completed).length}
            </p>
          </div>
        </div>

        {/* 🏫 Classroom Filter */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-sm font-medium">
            Filter by Classroom:
          </label>

          <select
            value={selectedClassroom}
            onChange={(e) =>
              setSelectedClassroom(e.target.value)
            }
            className="p-2 border rounded w-full sm:w-auto"
          >
            <option value="all">
              All Classrooms
            </option>

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

        {/* 🎉 Empty State */}
        {tasks.length === 0 && (
          <div className="p-6 bg-white rounded-lg shadow text-center">
            <p className="text-gray-500">
              No tasks for today 🎉
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
                  className="p-4 bg-white rounded-xl shadow flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold">
                      {task.title}
                    </p>
                    <p className="text-sm text-gray-400">
                      {task.classrooms?.name || "No classroom"}
                    </p>
                  </div>

                  <button
                    onClick={() => toggleComplete(task)}
                    className={`px-4 py-2 text-base rounded ${
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
                  className="p-4 bg-white rounded-xl shadow flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold">
                      {task.title}
                    </p>
                    <p className="text-sm text-gray-400">
                      {task.children?.name || "No child assigned"}
                    </p>
                  </div>

                  <button
                    onClick={() => toggleComplete(task)}
                    className={`px-4 py-2 text-base rounded ${
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