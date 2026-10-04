export type CareStaff = { id: string; name: string; role: string; status: string; location_ids: string[] }
export type CareGroup = { id: string; name: string; kind: string; location_id: string; member_ids: string[]; version: number }
export type CareContext = { staff: CareStaff[]; groups: CareGroup[]; location_ids: string[]; member_ids: string[]; primary_id: string | null; version: number | null }
export const careRoles = ["therapist", "teacher", "educator", "assistant", "aide", "caregiver", "staff"]
export function eligibleStaff(staff: CareStaff, locations: string[]) {
  return staff.status === "active" && careRoles.includes(staff.role) && staff.location_ids.some(id => locations.includes(id))
}
export function selectPeople(selected: string[], ids: string[], checked: boolean) {
  return checked ? [...new Set([...selected, ...ids])] : selected.filter(id => !ids.includes(id))
}
export function groupSelection(memberIds: string[], selected: string[]) {
  const ids = [...new Set(memberIds)]
  const count = ids.filter(id => selected.includes(id)).length
  return { count, total: ids.length, all: ids.length > 0 && count === ids.length, partial: count > 0 && count < ids.length }
}
