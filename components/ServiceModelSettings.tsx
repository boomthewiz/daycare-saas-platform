"use client"
import { useState } from "react"
import { useServiceModel } from "@/components/ServiceModelProvider"
import { useOrganizationWriteAccess } from "@/components/SubscriptionWriteControls"
import { supabase } from "@/lib/supabase"
import type { ServiceModel } from "@/lib/schedule-intent"
const previews = {
 unconfirmed: "Existing defaults remain until an authorized person confirms a service model.",
 daycare: "Start with daily Classes and group Activity creation. Individual Activities and ABA remain available with existing permissions.",
 aba: "Start with ABA session detail and clinical drafts. Clinical eligibility and preparation checks still apply.",
 mixed: "Start with All scheduled work and an explicit choice of ABA session, individual Activity or group Activity."
}
export default function ServiceModelSettings() {
 const {data}=useServiceModel()
 return <ServiceModelForm key={data?`${data.organizationId}:${data.userId}`:"unverified"} />
}
function ServiceModelForm() {
 const {data,error,refresh}=useServiceModel()
 const {allowed}=useOrganizationWriteAccess()
 const [proposal,setProposal]=useState<ServiceModel | "">("")
 const [review,setReview]=useState<{organizationId:string;version:number}|null>(null)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("")
 const selected=proposal||data?.model||"unconfirmed"
 async function save() {
  if (!data || !review || !proposal || !allowed || busy) return
  setBusy(true); setMessage("")
  try {
   const result=await supabase.rpc("set_account_service_model",{p_organization:review.organizationId,p_model:proposal,p_version:review.version})
   if(result.error)throw new Error(result.error.message)
   setProposal("");setReview(null);setMessage("Service model saved.");await refresh()
   window.dispatchEvent(new Event("rejoyce:service-model-changed"))
  }catch(cause){setMessage(cause instanceof Error?cause.message:"Unable to save.")}
  finally{setBusy(false)}
 }
 return <section className="rj-card space-y-3 break-words p-5" aria-label="Business service model">
  <h2 className="rj-heading-3">Business service model</h2>
  {error ? <p role="alert">{error}</p> : !data ? <p>Checking service model…</p> : <>
   <p>Current: {data.model === "aba" ? "ABA" : data.model === "unconfirmed" ? "Unconfirmed" : data.model === "daycare" ? "Daycare" : "Mixed"} · Version {data.version}</p>
   {data.updatedAt && <p className="text-sm">Changed {new Date(data.updatedAt).toLocaleString()} by account {data.updatedBy}</p>}
   <label className="block">Service model<select className="rj-input mt-2" value={selected} disabled={!data.canManage||!data.canWrite||!allowed||busy} onChange={e=>{setProposal(e.target.value as ServiceModel);setReview({organizationId:data.organizationId,version:data.version});setMessage("")}}>
    <option value="unconfirmed" disabled>Unconfirmed</option><option value="daycare">Daycare</option><option value="aba">ABA</option><option value="mixed">Mixed</option>
   </select></label>
   <p>{previews[selected]}</p>
   <p className="text-sm">This changes defaults only. Vocabulary, permissions, enabled workflows and historical records stay as saved. Existing future work remains accessible through All scheduled work and Schedule.</p>
   {review && review.version!==data.version && <p role="alert">The service model changed while you were reviewing. Reload and choose again.</p>}
   <button type="button" className="rj-button rj-button-primary" disabled={!proposal||!review||review.organizationId!==data.organizationId||review.version!==data.version||!data.canManage||!data.canWrite||!allowed||busy} onClick={()=>void save()}>{busy?"Saving…":"Confirm service model"}</button>
   {!data.canManage&&<p>Owner or administrator with account-management authority required to confirm.</p>}
  </>}
  <button type="button" className="underline" disabled={busy} onClick={()=>{setProposal("");setReview(null);void refresh()}}>Reload current setting</button>
  {message&&<p role="status">{message}</p>}
 </section>
}
