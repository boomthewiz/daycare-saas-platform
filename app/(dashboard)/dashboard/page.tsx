"use client"

import Link from "next/link"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import ScheduleCalendar from "@/components/ScheduleCalendar"

export default function DashboardPage() {
  const { data: capabilities } = useEffectiveCapabilities()
  return <div className="space-y-4">
    {capabilities?.accessRequests && <Link href="/access-requests" className="rj-button rj-button-secondary">Pending access requests</Link>}
    <ScheduleCalendar />
  </div>
}
