'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

import Sidebar from '../../components/Sidebar' 

export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')

  const [teachers, setTeachers] = useState<any[]>([])
  const [loadingInvite, setLoadingInvite] = useState(false)

  const [activeTeacher, setActiveTeacher] = useState<string | null>(null)
  const [childName, setChildName] = useState('')
  const [childAge, setChildAge] = useState('')

  const inviteTeacher = async () => {
    if (!profile) return

    setLoadingInvite(true)

    const res = await fetch('/api/invite-teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        fullName: name,
        daycareId: profile.daycare_id
      })
    })

    const result = await res.json()

    if (result.error) {
      alert(result.error)
    } else {
        alert('Teacher invited successfully!')
        setEmail('')
        setName('')
      
        fetchTeachers()
      }

      setLoadingInvite(false)
  }
  const fetchTeachers = async () => {
    if (!profile) return
  
    const { data, error } = await supabase
    .from('users')
    .select(`
      *,
      children (
        id,
        name,
        age
      )
    `)
    .eq('daycare_id', profile.daycare_id)
    .eq('role', 'teacher')
      
    if (error) {
      console.error("Teacher fetch error:", error)
      return
    }
  
    setTeachers(data || [])
  }

  const addChild = async (teacherId: string) => {
    if (!profile) return
  
    const { error } = await supabase
      .from('children')
      .insert({
        name: childName,
        age: childAge,
        teacher_id: teacherId,
        daycare_id: profile.daycare_id
      })
  
    if (error) {
      alert(error.message)
      return
    }
  
    setChildName('')
    setChildAge('')
    setActiveTeacher(null)
  
    fetchTeachers()
  }

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      setProfile(data)
    }

    loadUser()
  }, [])

  useEffect(() => {
    if (!profile) return

    console.log("Owner daycare:", profile.daycare_id)

    const fetchTeachers = async () => {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('daycare_id', profile.daycare_id)
        .eq('role', 'teacher')

        console.log("Teacher query result:", data)
  console.log("Teacher query error:", Error)

      setTeachers(data || [])
    }

    fetchTeachers()
  }, [profile])

  console.log("SUPABASE URL:", process.env.NEXT_PUBLIC_SUPABASE_URL)

  if (!profile) return <div className="p-10">Loading...</div>

  
  return (
    <div className="p-10">
      <h1>Welcome {profile.full_name}</h1>
      <p>Role: {profile.role}</p>
      <p>Daycare ID: {profile.daycare_id}</p>

      <div className="mt-10 flex flex-col gap-2 max-w-sm">
        <h2 className="font-bold">Invite Teacher</h2>

        <input
          type="text"
          placeholder="Teacher Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border p-2"
        />

        <input
          type="email"
          placeholder="Teacher Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2"
        />

<button
  onClick={inviteTeacher}
  disabled={loadingInvite}
  className="bg-blue-600 text-white p-2"
>
  {loadingInvite ? "Inviting..." : "Invite Teacher"}
</button>

      </div>
      <div className="mt-10">
      <h2 className="text-xl font-semibold mb-4">Teachers</h2>
      

  {teachers.map((teacher) => (
    <div
      key={teacher.id}
      className="bg-white shadow rounded-xl p-5 border"
      >
      <h3 className="font-semibold">{teacher.full_name}</h3>

        {/* Teacher Header */}
        <div className="flex items-center gap-3 mb-3">

<div className="w-10 h-10 bg-blue-500 text-white flex items-center justify-center rounded-full font-semibold">
  {teacher.full_name.charAt(0)}
</div>

<div>
  <h3 className="font-semibold text-lg">
    {teacher.full_name}
  </h3>

  <p className="text-sm text-gray-500">
    {teacher.children?.length || 0} Children
  </p>
</div>

</div>

      <p className="text-sm text-gray-500">
        Assigned Children: {teacher.children?.length || 0}
      </p>

      <div className="flex flex-wrap gap-2 mt-2">

{teacher.children?.map((child: any) => (
  <span
    key={child.id}
    className="bg-gray-100 text-sm px-3 py-1 rounded-full"
  >
    {child.name} ({child.age})
  </span>
))}

</div>
<button
  className="mt-4 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm"
  onClick={() => setActiveTeacher(teacher.id)}
>
  + Add Child
</button>      {activeTeacher === teacher.id && (
  <div className="mt-3 flex flex-col gap-2 max-w-xs">

    <input
      type="text"
      placeholder="Child Name"
      value={childName}
      onChange={(e) => setChildName(e.target.value)}
      className="border p-2"
    />

    <input
      type="number"
      placeholder="Age"
      value={childAge}
      onChange={(e) => setChildAge(e.target.value)}
      className="border p-2"
    />

    <button
      className="bg-blue-600 text-white p-2"
      onClick={() => addChild(teacher.id)}
    >
      Save Child
    </button>

  </div>
)}
    </div>
  ))}
</div>
    </div>
    
  )
}  