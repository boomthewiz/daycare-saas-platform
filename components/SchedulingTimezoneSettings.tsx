"use client"
import { useState } from "react"
import { useSchedulingTimezone } from "@/components/SchedulingTimezoneProvider"
import { supabase } from "@/lib/supabase"
export default function SchedulingTimezoneSettings() {
 const {data}=useSchedulingTimezone()
 return <TimezoneForm key={data?`${data.organizationId}:${data.userId}`:"unverified"}/>
}
function TimezoneForm(){
 const {data,error,refresh}=useSchedulingTimezone()
 const [proposal,setProposal]=useState("")
 const [review,setReview]=useState<{zone:string;version:number}|null>(null)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("")
 return <section className="rj-card space-y-3 p-5" aria-label="Organization scheduling timezone">
  <h2 className="rj-heading-3">Organization scheduling timezone</h2>
  {error&&<p role="alert">{error}</p>}
  {!data?<p>Checking scheduling timezone…</p>:<>
   <p>Current: {data.timezone||"Not confirmed"} · Version {data.version}</p>
   <p>Calendar dates, new bookings and schedule edits use this timezone, including when staff travel. Existing bookings keep their exact UTC instants. Reporting and attendance reporting retain their separate timezone setting.</p>
   {data.canManage&&<>
    <label className="block">IANA scheduling timezone<input className="rj-input mt-2" placeholder="America/Chicago" value={proposal} disabled={busy||!data.canWrite} onChange={e=>{setProposal(e.target.value);setReview(null);setMessage("")}}/></label>
    <button type="button" className="rj-button rj-button-secondary" disabled={busy||!data.canWrite||!proposal.trim()} onClick={()=>{try{new Intl.DateTimeFormat("en",{timeZone:proposal.trim()});setReview({zone:proposal.trim(),version:data.version});setMessage("")}catch{setMessage("Choose a valid IANA timezone, such as America/Chicago.")}}}>Review timezone change</button>
    {review&&<div className="space-y-3 rounded-xl border p-3"><p>Use {review.zone} for everyone’s scheduling. Existing UTC instants remain unchanged; their displayed date/time may change. Review open drafts again after this change.</p>
     <button type="button" className="rj-button rj-button-primary" disabled={busy||!data.canWrite||review.version!==data.version} onClick={async()=>{setBusy(true);setMessage("");try{const result=await supabase.rpc("set_scheduling_timezone",{p_organization:data.organizationId,p_timezone:review.zone,p_version:review.version});if(result.error)throw new Error(result.error.message);setReview(null);setProposal("");await refresh();window.dispatchEvent(new Event("rejoyce:scheduling-timezone-changed"));window.dispatchEvent(new Event("rejoyce:schedule-changed"));setMessage("Scheduling timezone saved. Existing booking instants were preserved.")}catch(cause){setMessage(cause instanceof Error?cause.message:"Unable to save timezone.")}finally{setBusy(false)}}}>Confirm scheduling timezone</button>
     {review.version!==data.version&&<p role="alert">The setting changed. Reload and review again.</p>}
    </div>}
   </>}
   {!data.canManage&&<p>An owner or administrator with account-management authority must confirm this setting.</p>}
  </>}
  <button type="button" className="underline" disabled={busy} onClick={()=>{setReview(null);void refresh()}}>Reload scheduling timezone</button>
  {message&&<p role="status">{message}</p>}
 </section>
}
