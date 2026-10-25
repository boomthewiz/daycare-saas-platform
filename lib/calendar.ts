import { dayBoundary, nextCivilDate, zonedCivil } from "./scheduling-timezone"

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return localDate(date) === value ? date : null
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return addDays(start, -start.getDay())
}

export function localDateTime(date: Date): string {
  return `${localDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

// URL drafts must be real local times, including around daylight-saving changes.
export function parseCalendarDraft(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return ""
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && localDateTime(date) === value ? value : ""
}

export type TimedEvent = { id: string; scheduled_start: string | null; scheduled_end: string | null }
export type PlacedEvent<T> = { event: T; start: number; end: number; column: number; columns: number }

// Clip overnight sessions to each day, then allocate columns for overlapping groups.
export function placeEvents<T extends TimedEvent>(events: T[], day: Date, timezone?: string): PlacedEvent<T>[] {
  const key = localDate(day)
  const floor = timezone ? new Date(dayBoundary(key,timezone)) : new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const ceiling = timezone ? new Date(dayBoundary(nextCivilDate(key),timezone)) : addDays(floor, 1)
  const items = events.flatMap(event => {
    if (!event.scheduled_start) return []
    const start = new Date(event.scheduled_start)
    const parsedEnd = event.scheduled_end ? new Date(event.scheduled_end) : null
    const end = parsedEnd && parsedEnd > start ? parsedEnd : new Date(start.getTime() + 30 * 60000)
    if (!Number.isFinite(start.getTime()) || end <= floor || start >= ceiling) return []
    const minute = (instant: Date) => timezone ? Number(zonedCivil(instant.toISOString(),timezone).slice(11,13))*60+Number(zonedCivil(instant.toISOString(),timezone).slice(14,16)) : instant.getHours()*60+instant.getMinutes()
    const startMinute = start < floor ? 0 : minute(start)
    const endMinute = end >= ceiling ? 1440 : minute(end)
    return [{ event, start: startMinute, end: Math.max(startMinute + 1, endMinute), column: 0, columns: 1 }]
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id))
  let group: PlacedEvent<T>[] = [], ends: number[] = [], groupEnd = -1
  const finish = () => { for (const item of group) item.columns = ends.length }
  for (const item of items) {
    if (item.start >= groupEnd) { finish(); group = []; ends = []; groupEnd = -1 }
    let column = ends.findIndex(end => end <= item.start)
    if (column < 0) column = ends.length
    item.column = column
    ends[column] = item.end
    group.push(item)
    groupEnd = Math.max(groupEnd, item.end)
  }
  finish()
  return items
}
