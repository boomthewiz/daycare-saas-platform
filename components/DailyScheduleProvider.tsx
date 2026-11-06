"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useBranches } from "@/components/BranchProvider"
import { useSchedulingTimezone } from "@/components/SchedulingTimezoneProvider"
import { civilDate, dayBoundary, nextCivilDate } from "@/lib/scheduling-timezone"
import { readCalendarSessions } from "@/lib/calendar-data"

const DailySchedule = createContext({ today: null as number | null, completed: null as number | null, error: "", refresh: async () => {} })

export default function DailyScheduleProvider({ children }: { children: ReactNode }) {
  const {data:clock}=useSchedulingTimezone()
  const timezone=clock?.timezone||""
  const todayKey=useCallback(()=>timezone?civilDate(new Date().toISOString(),timezone):"",[timezone])
  const { selectedBranchId, loading: branchLoading, error: branchError } = useBranches()
  const [counts, setCounts] = useState<{ today: number | null; completed: number | null }>({ today: null, completed: null })
  const [error, setError] = useState("")
  const [day, setDay] = useState(() => todayKey())
  const version = useRef({ value: 0 })
  const refresh = useCallback(async () => {
    const request = ++version.current.value
    setCounts({ today: null, completed: null })
    setError("")
    if (!timezone || branchLoading || branchError) return
    try {
      const date=civilDate(new Date().toISOString(),timezone)
      const start=new Date(dayBoundary(date,timezone))
      const rows=await readCalendarSessions(start,new Date(dayBoundary(nextCivilDate(date),timezone)),selectedBranchId)
      if (request !== version.current.value) return
      // Counters count sessions starting today, including completed/cancelled records.
      const today = rows.filter(row => row.scheduled_start && civilDate(row.scheduled_start,timezone) === date)
      setCounts({ today: today.length, completed: today.filter(row => row.status === "completed").length })
    } catch (cause) {
      if (request === version.current.value) setError(cause instanceof Error ? cause.message : "Unable to load today's totals.")
    }
  }, [selectedBranchId, branchLoading, branchError, timezone])
  useEffect(() => {
    let active = true
    const counter = version.current
    void Promise.resolve().then(() => { if (active) void refresh() })
    const onRefresh = () => { void refresh() }
    const onFocus = () => { setDay(todayKey()); void refresh() }
    const timer = window.setInterval(() => { if (!document.hidden) setDay(todayKey()) }, 60000)
    window.addEventListener("rejoyce:schedule-changed", onRefresh)
    window.addEventListener("focus", onFocus)
    return () => { active = false; counter.value++; window.clearInterval(timer); window.removeEventListener("rejoyce:schedule-changed", onRefresh); window.removeEventListener("focus", onFocus) }
  }, [refresh, day, timezone, todayKey])
  return <DailySchedule.Provider value={{ ...counts, error: branchError || error, refresh }}>{children}</DailySchedule.Provider>
}

export function useDailySchedule() { return useContext(DailySchedule) }
