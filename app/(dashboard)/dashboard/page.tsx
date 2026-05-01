"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"

export default function DashboardPage() {
const router = useRouter()
// 🔐 Auth + loading state
  const [checkingAuth, setCheckingAuth] = useState(true)

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

   // 🔐 Check login session first
  const checkUserSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push("/login")
      return
    }

    setCheckingAuth(false)

    // Only fetch data if authenticated
    fetchTasks()
    fetchClassrooms()
  }

  useEffect(() => {
    const checkUserSession = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    router.push("/login")
    return
  }

  // 🔐 Check if user has PIN
  const { data: userData, error } = await supabase
    .from("users")
    .select("pin_hash")
    .eq("id", session.user.id)
    .single()

  if (error) {
    console.error("User fetch error:", error)
    return
  }

  // 🚨 No PIN → force setup
  if (!userData?.pin_hash) {
    router.push("/set-pin")
    return
  }

  // ✅ User is fully authenticated
  setCheckingAuth(false)

  fetchTasks()
  fetchClassrooms()
}

  // 👀 Watch for session expiration/logout
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push("/login")
      }
    })

  // 🔴 Realtime tasks updates
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

      // 🧹 Cleanup
    return () => {
      subscription.unsubscribe()
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
 
 // ⏳ Auth check loading
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg text-gray-500">
          Checking login...
        </p>
      </div>
    )
  }

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

        {/* 👑 Owner Quick Actions */}
<div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">

  <button
    onClick={() => router.push("/operations")}
    className="p-5 rounded-3xl bg-white shadow-lg hover:scale-105 transition-all text-left"
  >
    <h3 className="text-lg font-bold">
      ✨ Create First Task
    </h3>
    <p className="text-sm text-gray-500 mt-1">
      Build daily operations and assign recurring tasks
    </p>
  </button>

  <button
    onClick={() => router.push("/invite-teacher")}
    className="p-5 rounded-3xl bg-white shadow-lg hover:scale-105 transition-all text-left"
  >
    <h3 className="text-lg font-bold">
      👩‍🏫 Invite Teachers
    </h3>
    <p className="text-sm text-gray-500 mt-1">
      Add staff and assign classrooms
    </p>
  </button>
</div>

{/* 🏫 Classroom Quick Access */}
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
        <p className="font-semibold">
          {room.name}
        </p>
      </button>
    ))}
  </div>
</div>

        {tasks.length === 0 && (
  <div className="p-8 bg-white rounded-3xl shadow-lg text-center">
    <h2 className="text-2xl font-bold mb-2">
      🎉 Welcome to ReJoyce
    </h2>

    <p className="text-gray-500 mb-6">
      Let’s create your first task and start organizing your daycare
    </p>

    <button
      onClick={() => router.push("/operations")}
      className="px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white font-semibold shadow-lg hover:scale-105 transition-all"
    >
      ✨ Create First Task
    </button>
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