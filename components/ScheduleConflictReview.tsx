"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { supabase } from "@/lib/supabase"
export type ConflictSummary = { reviewId:string; totalEvents:number; staffEvents:number; childEvents:number; uncertainEvents:number; expiresAt:string }
type Acknowledgement = {reason:string;staff:boolean;children:boolean;uncertainty:boolean}
type Pending = {summary:ConflictSummary;resolve:(value:Acknowledgement|null)=>void}
function normalize(value:unknown):ConflictSummary {
 const data=value as ConflictSummary
 if(!data || typeof data.reviewId!=="string" || ![data.totalEvents,data.staffEvents,data.childEvents,data.uncertainEvents].every(n=>Number.isInteger(n)&&n>=0) || typeof data.expiresAt!=="string")throw new Error("Unable to verify schedule conflicts. Retry the check.")
 return data
}
export function useScheduleConflictReview(){
 const {data:caps}=useEffectiveCapabilities()
 const scope=caps?`${caps.organizationId}:${caps.userId}`:""
 const scopeRef=useRef(scope)
 const waiting=useRef<Pending|null>(null)
 const [pending,setPending]=useState<Pending|null>(null)
 useEffect(()=>{scopeRef.current=scope;const active=waiting;return()=>{scopeRef.current="";active.current?.resolve(null);active.current=null}},[scope])
 const finish=useCallback((value:Acknowledgement|null)=>{waiting.current?.resolve(value);waiting.current=null;setPending(null)},[])
 const save=async(action:string,payload:Record<string,unknown>)=>{
  const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
  try {
  const expected=scope
  if(!expected||!caps?.sessions||!caps.canWrite)throw new Error("Verify scheduling and editing access before saving.")
  let review:string|null=null,ack:Acknowledgement={reason:"",staff:false,children:false,uncertainty:false}
  for(let attempt=0;attempt<4;attempt++){
   const result=await supabase.rpc("save_reviewed_schedule",{p_action:action,p_payload:payload,p_review:review,p_ack:ack})
   if(scopeRef.current!==expected)return null
   if(result.error)throw new Error(result.error.message)
   if(!result.data?.review_required){
    if(!result.data || (typeof result.data.session_id!=="string"&&typeof result.data.id!=="string"))throw new Error("Save response could not be verified. Check save recovery before trying again.")
    return result.data
   }
   const summary=normalize(result.data.review_required);review=summary.reviewId
   if(!summary.totalEvents)continue
   const choice=await new Promise<Acknowledgement|null>(resolve=>{const next={summary,resolve};waiting.current=next;setPending(next)})
   if(!choice||scopeRef.current!==expected)return null
   ack=choice
  }
  throw new Error("The schedule is changing. Review again before saving; no new save was confirmed.")
  } finally { requestAnimationFrame(()=>{if(returnFocus?.isConnected&&!returnFocus.hasAttribute("disabled"))returnFocus.focus()}) }
 }
 return {save,dialog:pending?createPortal(<ConflictDialog key={pending.summary.reviewId} summary={pending.summary} finish={finish}/>,document.querySelector(".rj-portal") || document.body):null}
}
function ConflictDialog({summary,finish}:{summary:ConflictSummary;finish:(value:Acknowledgement|null)=>void}){
 const dialog=useRef<HTMLDialogElement>(null)
 const [ack,setAck]=useState<Acknowledgement>({reason:"",staff:false,children:false,uncertainty:false})
 useEffect(()=>{const node=dialog.current;node?.showModal();node?.querySelector<HTMLElement>("#conflict-review-title")?.focus();return()=>node?.close()},[])
 const ready=ack.reason.trim().length>=10&&ack.reason.trim().length<=500&&(!summary.staffEvents||ack.staff)&&(!summary.childEvents||ack.children)&&(!summary.uncertainEvents||ack.uncertainty)
 return <dialog ref={dialog} className="rj-conflict-dialog" aria-labelledby="conflict-review-title" onCancel={event=>{event.preventDefault();finish(null)}}>
  <form onSubmit={event=>{event.preventDefault();if(ready)finish(ack)}} className="space-y-4 p-5 sm:p-6">
   <p className="rj-label">Schedule review</p><h2 id="conflict-review-title" tabIndex={-1} className="rj-heading-2">Review overlapping work</h2>
   <p>{summary.totalEvents} scheduled {summary.totalEvents===1?"event needs":"events need"} review. One event can involve both staff and children. Restricted event details stay private.</p>
   {!!summary.staffEvents&&<div className="rj-conflict-warning"><p className="font-bold">Staff overlap · priority review</p><p>{summary.staffEvents} event(s) share assigned staff. Confirm the staffing plan before continuing.</p><label className="rj-review-check"><input type="checkbox" checked={ack.staff} onChange={e=>setAck({...ack,staff:e.target.checked})}/>I reviewed the overlapping staff assignments</label></div>}
   {!!summary.childEvents&&<div className="rj-conflict-warning"><p className="font-bold">Child overlap · review the plan</p><p>{summary.childEvents} event(s) share children. An ABA pull-out during a class can be intentional; no child will be removed from another roster.</p><label className="rj-review-check"><input type="checkbox" checked={ack.children} onChange={e=>setAck({...ack,children:e.target.checked})}/>I reviewed child overlaps and any planned pull-out</label></div>}
   {!!summary.uncertainEvents&&<label className="rj-review-check"><input type="checkbox" checked={ack.uncertainty} onChange={e=>setAck({...ack,uncertainty:e.target.checked})}/>I reviewed {summary.uncertainEvents} event(s) with an unknown end time; overlap is uncertain</label>}
   <label className="block">Review reason<textarea className="rj-input mt-2" required minLength={10} maxLength={500} rows={3} value={ack.reason} onChange={e=>setAck({...ack,reason:e.target.value})} aria-describedby="conflict-reason-help"/></label>
   <p id="conflict-reason-help" className="text-sm">10–500 characters. Describe the scheduling decision without clinical notes. Review is not verified attendance, coverage, ratios or billing.</p>
   <p className="text-sm">The server checks again on save. These warnings do not guarantee a conflict-free schedule across older clients.</p>
   <div className="rj-action-row"><button type="button" className="rj-button rj-button-secondary" onClick={()=>finish(null)}>Go back and adjust</button><button type="submit" className="rj-button rj-button-primary" disabled={!ready}>Acknowledge and continue</button></div>
  </form>
 </dialog>
}
