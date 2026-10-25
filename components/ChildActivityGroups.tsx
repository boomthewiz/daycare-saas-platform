"use client"
import { useSchedulingTimezone } from "@/components/SchedulingTimezoneProvider"
import { zonedLabel } from "@/lib/scheduling-timezone"
import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { readGroupActivities, type ClassContext } from "@/lib/activity-groups"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
export default function ChildActivityGroups({ childId }: { childId: string }) {
 const {data:clock}=useSchedulingTimezone()
 const { data: caps } = useEffectiveCapabilities()
 const [data, setData] = useState<{ context: ClassContext; activities: { id: string; activity_title: string; scheduled_start: string; status: string }[] } | null>(null)
 const [error, setError] = useState(""), [attempt, setAttempt] = useState(0)
 useEffect(() => {
  let live = true
  setData(null); setError("")
  if (!caps || !(caps.clients || caps.sessions)) return
  void (async () => {
   try {
    const [context, activities] = await Promise.all([supabase.rpc("activity_class_context"), caps.sessions ? readGroupActivities({ child: childId }) : Promise.resolve([])])
    if (!live) return
    if (context.error || context.data?.organizationId !== caps.organizationId || context.data?.userId !== caps.userId) throw new Error(context.error?.message || "Class access changed.")
    setData({ context: context.data as ClassContext, activities })
   } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Unable to load activity groups.") }
  })()
  const clear = (event: Event) => { if ((event as CustomEvent<string>).detail !== "unlocked") { live = false; setData(null) } else setAttempt(value => value + 1) }
  window.addEventListener("rejoyce:device-state", clear)
  return () => { live = false; window.removeEventListener("rejoyce:device-state", clear) }
 }, [caps, childId, attempt])
 if (!caps || !(caps.clients || caps.sessions)) return null
 return <section className="rj-card space-y-3 p-5"><h2 className="rj-heading-2">Classes and group activities</h2>
  {error && <p role="alert">{error} <button className="underline" onClick={() => setAttempt(value => value + 1)}>Retry activity groups</button></p>}
  {data && <><p>Reusable classes: {data.context.classes.filter(item => item.active && item.child_ids.includes(childId)).map(item => item.name).join(", ") || "None assigned"}</p><Link href="/classes" className="underline">Review class rosters</Link>
   {data.activities.map(activity => <Link className="block underline" key={activity.id} href={`/activity/${activity.id}`}>{activity.activity_title} · {clock?.timezone?zonedLabel(activity.scheduled_start,clock.timezone):"Scheduling timezone not confirmed"} · {activity.status}</Link>)}
   <p className="text-sm">Current class membership and saved activity participation are separate. Attendance is recorded separately.</p></>}
 </section>
}
