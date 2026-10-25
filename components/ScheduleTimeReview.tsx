"use client"
import { civilCandidates, zonedLabel } from "@/lib/scheduling-timezone"
import { useScheduleClock, useSchedulingTimezone } from "@/components/SchedulingTimezoneProvider"
export default function ScheduleTimeReview({start,end,startOccurrence,endOccurrence,onStartOccurrence,onEndOccurrence}:{start:string;end:string;startOccurrence:string;endOccurrence:string;onStartOccurrence:(value:string)=>void;onEndOccurrence:(value:string)=>void}){
 const {refresh}=useSchedulingTimezone()
 const {timezone:zone,error}=useScheduleClock()
 const options=(value:string)=>{try{return zone&&value?civilCandidates(value,zone):[]}catch{return []}}
 return <section className="space-y-3" aria-label="Schedule timezone review">
  <p>Organization scheduling timezone: <strong>{zone||"Not confirmed"}</strong>. Start and end fields use this timezone.</p>
  {error&&<p role="alert">{error} <button type="button" className="underline" onClick={()=>void refresh()}>Retry timezone</button></p>}
  {!zone&&<p role="alert">An authorized administrator must confirm the scheduling timezone in Setup before saving scheduled work.</p>}
  {zone&&([['Start',start,startOccurrence,onStartOccurrence],['End',end,endOccurrence,onEndOccurrence]] as const).map(([label,value,occurrence,change])=>{
   const choices=options(value)
   return value?<div key={label}>{!choices.length?<p role="alert">{label}: this civil time is invalid or does not exist in {zone}. Choose another time.</p>:choices.length>1?<label className="block">{label} clock-change occurrence<select className="rj-input" value={choices.includes(occurrence)?occurrence:""} onChange={e=>change(e.target.value)}><option value="">Choose earlier or later</option>{choices.map((instant,index)=><option key={instant} value={instant}>{index===0?"Earlier":"Later"}: {zonedLabel(instant,zone)} · {instant}</option>)}</select></label>:<p className="text-sm">{label}: {zonedLabel(choices[0],zone)}</p>}</div>:null
  })}
 </section>
}
