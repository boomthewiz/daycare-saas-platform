"use client"

import { useEffect, useState } from "react"
import { supabase } from '../../lib/supabase'

export default function DashboardPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedClassroom, setSelectedClassroom] = useState("all")
  const [classrooms, setClassrooms] = useState<any[]>([])
  const fetchClassrooms = async () => {
  const { data } = await supabase
    .from("classrooms")
    .select("id, name")

  setClassrooms(data || [])
}

  // 🏫 Fetch classrooms for filter
  // 📅 Get today's date (matches generated_date in DB)
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

    if (!error) setTasks(data || [])
    setLoading(false)
  }

const filteredTasks =
  selectedClassroom === "all"
    ? tasks
    : tasks.filter((t) => t.classroom_id === selectedClassroom)

const classroomTasks = filteredTasks.filter((t) => t.classroom_id)
const childTasks = filteredTasks.filter((t) => t.child_id)

  useEffect(() => {
  fetchTasks()
  fetchClassrooms()

  // 🔴 Subscribe to real-time changes
  const channel = supabase
    .channel("tasks-realtime")
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

  // 🧹 Cleanup
  return () => {
    supabase.removeChannel(channel)
  }
}, [])

  // ✅ Toggle completion
  const toggleComplete = async (task: any) => {
    await supabase
      .from("tasks")
      .update({ completed: !task.completed })
      .eq("id", task.id)

    fetchTasks()
  }

return (
<div className="min-h-screen bg-gray-50 pb-20">
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">   
  
  {/* 🧠 Header */}
    <div className="mb-6">
      <h1 className="text-3xl font-bold">📋 Today’s Tasks</h1>
      <p className="text-gray-500">
        Track and complete daily classroom activities
      </p>
    </div>

    {/* 📊 Task Stats */}
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

    {/* Filter by Classroom */}
<div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-2">
  <label className="text-sm font-medium">
    Filter by Classroom:
  </label>

  <select
    value={selectedClassroom}
    onChange={(e) => setSelectedClassroom(e.target.value)}
  className="p-2 border rounded w-full sm:w-auto"
    >
    <option value="all">All Classrooms</option>

    {classrooms.map((room) => (
      <option key={room.id} value={room.id}>
        {room.name}
      </option>
    ))}
  </select>
</div>

    {!loading && tasks.length === 0 && (
  <div className="p-6 bg-white rounded-lg shadow text-center">
    <p className="text-gray-500">No tasks for today 🎉</p>
  </div>
)}

    {/* 🏫 Classroom Tasks */}
{classroomTasks.length > 0 && (
  <div className="mb-6">
    <h2 className="text-xl font-semibold mb-2">🏫 Classroom Tasks ({classroomTasks.length})</h2>

    <div className="space-y-3">
      {classroomTasks.map((task) => (
        <div
          key={task.id}
className="p-4 bg-white rounded-xl shadow flex flex-col sm:flex-row sm:items-center gap-3"        >
          <div>
            <p className="font-semibold">{task.title}</p>
            <p className="text-sm text-gray-400">
              {task.classrooms?.name}
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
    <h2 className="text-xl font-semibold mb-2">👶 Child Tasks ({childTasks.length})</h2>

    <div className="space-y-3">
      {childTasks.map((task) => (
        <div
          key={task.id}
          className="p-4 bg-white rounded-lg shadow flex justify-between"
        >
          <div>
            <p className="font-semibold">{task.title}</p>
            <p className="text-sm text-gray-400">
              {task.children?.name}
            </p>
          </div>

          <button
            onClick={() => toggleComplete(task)}
            className={`px-3 py-1 rounded ${
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
);
  
}