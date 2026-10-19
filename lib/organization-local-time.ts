/** Format a civil time in the recorded organization timezone, never the browser timezone. */
export function organizationLocalTime(instant:string,timezone:string):string {
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(instant))
 const part=(name:string)=>parts.find(value=>value.type===name)?.value||""
 return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`
}
