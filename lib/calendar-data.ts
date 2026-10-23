import { readGroupActivities } from "@/lib/activity-groups"
import { supabase } from "@/lib/supabase"

export type CalendarSession = {
  activity_title?: string
  group_activity?: boolean
  child_count?: number
  id: string
  status: string
  workflow_intent?: "activity" | "clinical"
  session_type: string
  scheduled_start: string | null
  scheduled_end: string | null
  location: string | null
  clients: { first_name: string; preferred_name: string | null } | null
  provider: { full_name: string | null; email: string | null } | null
}

export async function readCalendarSessions(start: Date, end: Date, branchId: string): Promise<CalendarSession[]> {
  const rows: CalendarSession[] = []
  const size = 500
  for (let offset = 0; ; offset += size) {
    // Inner joins make a selected client branch constrain the parent session rows.
    const clientFields = branchId
      ? "clients!inner(first_name,preferred_name,client_locations!inner(location_id))"
      : "clients(first_name,preferred_name)"
    let query = supabase.from("sessions").select(`id,status,workflow_intent,session_type,scheduled_start,scheduled_end,location,${clientFields},provider:users!sessions_provider_id_fkey(full_name,email)`)
      .lt("scheduled_start", end.toISOString())
      .or(`scheduled_end.gt.${start.toISOString()},and(scheduled_end.is.null,scheduled_start.gte.${start.toISOString()})`)
      .order("scheduled_start").order("id")
    if (branchId) query = query.eq("clients.client_locations.location_id", branchId)
    const { data, error } = await query.range(offset, offset + size - 1)
    if (error) throw new Error(error.message)
    const page = (data || []) as unknown as CalendarSession[]
    rows.push(...page)
    if (page.length < size) return [...rows, ...await readGroupActivities({from:start.toISOString(),to:end.toISOString(),branch:branchId})]
  }
}
