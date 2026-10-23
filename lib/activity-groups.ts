import { supabase } from "@/lib/supabase"
export type ActivityClass = { id: string; name: string; branch_id: string; active: boolean; version: number; child_ids: string[]; staff_ids: string[] }
export type ClassContext = { organizationId: string; userId: string; canEdit: boolean; canWrite: boolean; branches: { id: string; name: string; active: boolean }[]; children: { id: string; name: string; active: boolean; branch_ids: string[] }[]; staff: { id: string; name: string; active: boolean }[]; classes: ActivityClass[] }
export type GroupDraft = { classId: string; version: number; title: string; children: string[]; staff: string[] }
export const emptyGroup: GroupDraft = { classId: "", version: 0, title: "", children: [], staff: [] }
export function toggleMember(ids: string[], id: string, checked: boolean) { return checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id) }
export async function readGroupActivities(filters: { from?: string; to?: string; branch?: string; child?: string; assigned?: boolean } = {}) {
 const rows = []
 for (let page = 0; ; page++) {
  const result = await supabase.rpc("list_group_activities", { p_from: filters.from || null, p_to: filters.to || null, p_branch: filters.branch || null, p_child: filters.child || null, p_assigned: filters.assigned || false, p_page: page })
  if (result.error) throw new Error(result.error.message)
  if (!result.data || !Array.isArray(result.data.rows)) throw new Error("Unable to verify group activities.")
  rows.push(...result.data.rows)
  if (!result.data.hasMore) return rows
 }
}
