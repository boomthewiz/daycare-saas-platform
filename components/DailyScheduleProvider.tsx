"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useBranches } from "@/components/BranchProvider"
import { addDays, localDate } from "@/lib/calendar"
import { readCalendarSessions } from "@/lib/calendar-data"

const DailySchedule = createContext({ today: null as number | null, completed: null as number | null, error: "", refresh: async () => {} })

export default function DailyScheduleProvider({ children }: { children: ReactNode }) {
  const { selectedBranchId, loading: branchLoading, error: branchError } = useBranches()
  const [counts, setCounts] = useState<{ today: number | null; completed: number | null }>({ today: null, completed: null })
  const [error, setError] = useState("")
  const [day, setDay] = useState(() => localDate(new Date()))
  const version = useRef({ value: 0 })
  const refresh = useCallback(async () => {
    const request = ++version.current.value
    setCounts({ today: null, completed: null })
    setError("")
    if (branchLoading || branchError) return
    try {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const rows = await readCalendarSessions(start, addDays(start, 1), selectedBranchId)
      if (request !== version.current.value) return
      // Counters count sessions starting today, including completed/cancelled records.
      const today = rows.filter(row => row.scheduled_start && localDate(new Date(row.scheduled_start)) === localDate(start))
      setCounts({ today: today.length, completed: today.filter(row => row.status === "completed").length })
    } catch (cause) {
      if (request === version.current.value) setError(cause instanceof Error ? cause.message : "Unable to load today's totals.")
    }
  }, [selectedBranchId, branchLoading, branchError])
  useEffect(() => {
    let active = true
    const counter = version.current
    void Promise.resolve().then(() => { if (active) void refresh() })
    const onRefresh = () => { void refresh() }
    const onFocus = () => { setDay(localDate(new Date())); void refresh() }
    const timer = window.setInterval(() => { if (!document.hidden) setDay(localDate(new Date())) }, 60000)
    window.addEventListener("rejoyce:schedule-changed", onRefresh)
    window.addEventListener("focus", onFocus)
    return () => { active = false; counter.value++; window.clearInterval(timer); window.removeEventListener("rejoyce:schedule-changed", onRefresh); window.removeEventListener("focus", onFocus) }
  }, [refresh, day])
  return <DailySchedule.Provider value={{ ...counts, error: branchError || error, refresh }}>{children}</DailySchedule.Provider>
}

export function useDailySchedule() { return useContext(DailySchedule) }
