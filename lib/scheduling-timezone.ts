/** Civil scheduling values never pass through the device timezone. */
export function civilTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value)) throw new Error("Choose a valid date and time.")
  const date = new Date(value + "Z")
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== value.slice(0, 16) || Number(value.slice(17, 19) || 0) > 59) throw new Error("Choose a valid date and time.")
  return value
}
export function zonedCivil(instant: string, timezone: string): string {
  const date = new Date(instant)
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date)
  const p = (name: string) => parts.find(part => part.type === name)?.value || ""
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`
}
/** Test the actual offsets around the date, including half-hour DST and date-line changes. */
export function civilCandidates(value: string, timezone: string): string[] {
  const civil = civilTime(value), wall = new Date(civil + "Z").getTime()
  const offsets = new Set<number>()
  for (let hour = -48; hour <= 48; hour += 6) {
    const sample = wall + hour * 3600000
    offsets.add(new Date(zonedCivil(new Date(sample).toISOString(), timezone) + "Z").getTime() - sample)
  }
  return [...offsets].map(offset => new Date(wall - offset).toISOString()).filter(instant => new Date(zonedCivil(instant, timezone) + "Z").getTime() === wall).sort()
}
export function resolveCivil(value: string, timezone: string, occurrence = "", original?: string | null): string {
  const options = civilCandidates(value, timezone)
  if (!options.length) throw new Error(`This time does not exist in ${timezone} because the clocks change. Choose another time.`)
  // An unchanged saved instant is already an explicit occurrence. Preserve seconds/milliseconds.
  if (options.includes(occurrence)) return occurrence
  if (original && options.includes(new Date(original).toISOString())) return new Date(original).toISOString()
  if (options.length === 1) return options[0]
  throw new Error(`This time occurs twice in ${timezone}. Choose the earlier or later occurrence.`)
}
export function addCivilMinutes(value: string, minutes: number): string {
  return new Date(new Date(civilTime(value) + "Z").getTime() + minutes * 60000).toISOString().slice(0, 16)
}
export function civilDate(instant: string, timezone: string): string { return zonedCivil(instant, timezone).slice(0, 10) }
export function nextCivilDate(date: string): string { return addCivilMinutes(date + "T00:00", 1440).slice(0, 10) }
/** Midnight boundaries include 23/25-hour dates. PostgreSQL remains authoritative for commands. */
export function dayBoundary(date: string, timezone: string): string {
  const midnight = date + "T00:00"
  for (let minute = 0; minute < 1440; minute++) {
    const candidates = civilCandidates(addCivilMinutes(midnight, minute), timezone)
    if (candidates.length) return candidates[0]
  }
  throw new Error(`The date ${date} does not exist in ${timezone}.`)
}
export function zonedLabel(instant: string | null, timezone: string): string {
  return instant ? `${new Date(instant).toLocaleString(undefined, { timeZone: timezone, timeZoneName: "short" })} (${timezone})` : "No scheduled time"
}
