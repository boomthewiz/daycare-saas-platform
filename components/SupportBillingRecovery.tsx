"use client"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { supabase } from "@/lib/supabase"
import { recoveryContext, recoveryExpiry, recoveryReview, type RecoveryContext, type RecoveryReview } from "@/lib/billing-recovery-review"

type Props={organizationId:string;ticket:string;workforceVersion:number}
export default function SupportBillingRecovery({organizationId,ticket,workforceVersion}:Props){
 const [context,setContext]=useState<RecoveryContext|null>(null)
 const [review,setReview]=useState<RecoveryReview|null>(null)
 const [action,setAction]=useState<"grant"|"revoke">("grant")
 const [expiry,setExpiry]=useState("")
 const [reason,setReason]=useState("payment_recovery")
 const [reference,setReference]=useState("")
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("")
 const [attempt,setAttempt]=useState<{reviewId:string;operation:string}|null>(null)
 const [expired,setExpired]=useState(false)
 const generation=useRef(0)
 const load=useCallback(async()=>{
  const request=++generation.current;setBusy(true);setError("")
  try{
   const result=await supabase.rpc("support_billing_context",{p_org:organizationId,p_ticket:ticket,p_workforce_version:workforceVersion})
   if(request!==generation.current)return
   const value=!result.error&&recoveryContext(result.data,organizationId)
   if(!value)throw new Error("Recovery access could not be verified. Check workforce membership, MFA and device unlock.")
   setContext(value)
  }catch(cause){if(request===generation.current){setContext(null);setError(cause instanceof Error?cause.message:"Unable to check recovery access.")}}
  finally{if(request===generation.current)setBusy(false)}
 },[organizationId,ticket,workforceVersion])
 useEffect(()=>{const counter=generation;void load();return()=>{counter.current++}},[load])
 useEffect(()=>{
  if(!review)return
  const remaining=Date.parse(review.validUntil)-Date.parse(review.serverNow)
  const timer=window.setTimeout(()=>setExpired(true),Math.max(0,Math.min(remaining,2147483647)))
  return()=>clearTimeout(timer)
 },[review])
 const clearReview=()=>{setReview(null);setAttempt(null);setExpired(false);setMessage("");setError("")}
 async function prepare(event:FormEvent){
  event.preventDefault();if(!context?.policy||attempt)return
  const request=++generation.current;setBusy(true);setError("");setMessage("");setReview(null)
  try{
   const result=await supabase.rpc("prepare_billing_grace",{p_action:action,p_org:organizationId,p_grace:action==="revoke"?context.grace?.id||null:null,
    p_expected_version:context.version,p_policy_version:context.policy.version,p_expires:action==="grant"?recoveryExpiry(expiry):null,p_ticket:ticket,p_reason:reason,p_workforce_version:workforceVersion})
   if(request!==generation.current)return
   if(result.error)throw new Error(result.error.message)
   const value=recoveryReview(result.data,organizationId);if(!value)throw new Error("The reviewed recovery response could not be verified.")
   setReview(value);setExpired(false)
  }catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:"Unable to prepare recovery.")}
  finally{if(request===generation.current)setBusy(false)}
 }
 async function inspect(approve:boolean){
  const reviewId=approve?review?.id:reference.trim();if(!reviewId||attempt)return
  const request=++generation.current;setBusy(true);setError("");setMessage("")
  try{
   const result=await supabase.rpc("inspect_billing_grace_review",{p_review:reviewId,p_org:organizationId,p_approve:approve,p_workforce_version:workforceVersion})
   if(request!==generation.current)return
   if(result.error)throw new Error(result.error.message)
   const value=recoveryReview(result.data,organizationId);if(!value)throw new Error("The recovery review could not be verified.")
   setReview(value);setExpired(false);if(approve)setMessage("Independent approval recorded. The requesting operator must confirm the change.")
  }catch(cause){if(request===generation.current){setReview(null);setError(cause instanceof Error?cause.message:"Unable to load recovery review.")}}
  finally{if(request===generation.current)setBusy(false)}
 }
 async function confirm(){
  if(!review||!context)return
  const operation=attempt?.operation||crypto.randomUUID();const request=++generation.current
  setAttempt({reviewId:review.id,operation});setBusy(true);setError("");setMessage("")
  try{
   const result=await supabase.rpc("confirm_billing_grace",{p_review:review.id,p_org:organizationId,p_operation:operation,p_workforce_version:workforceVersion})
   if(request!==generation.current)return
   if(result.error){if(/^[0-9A-Z]{5}$/.test(result.error.code||""))setAttempt(null);throw new Error(result.error.message)}
   if(result.data?.organizationId!==organizationId||!Number.isInteger(result.data?.version))throw new Error("Confirmation outcome could not be verified. Retry the same confirmation.")
   setAttempt(null);setReview(null);setMessage("Recovery change saved with audit and an in-app customer notice. Payment history is unchanged.")
   await load()
  }catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:"Confirmation was interrupted. Retry the same confirmation to recover its result.")}
  finally{if(request===generation.current)setBusy(false)}
 }
 const approvalRequired=review?.request.action==="grant"&&review.snapshot.policy?.requiresSecondApproval===true
 return <section className="rj-card space-y-5 p-5" aria-label="Billing recovery">
  <h2 className="rj-heading-2">Billing recovery</h2>
  <p>Review temporary workspace access separately from payment. No invoice is marked paid by this workflow.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!context&&!error&&<p role="status">Checking recovery access…</p>}
  {context&&<>
   <h3 className="font-semibold">{context.organizationName}</h3>
   <dl className="space-y-1"><dt>Recorded trial end</dt><dd>{context.trialEndsAt?new Date(context.trialEndsAt).toISOString():"Not managed"}</dd><dt>Recorded paid-through date</dt><dd>{context.paidThrough?new Date(context.paidThrough).toISOString():"No date recorded"}</dd><dt>Current support grace</dt><dd>{context.grace?new Date(context.grace.expiresAt).toISOString():"None"}</dd></dl>
   <p className="rj-caption">Payment-provider reconciliation is not configured here. Verify provider payment facts before choosing temporary assistance.</p>
   {!context.managed?<p role="status">This organization is not managed by the billing recovery system.</p>:!context.policy?<p role="status">No approved recovery policy is active. Recovery actions are unavailable.</p>:<>
    <p>Policy {context.policy.version}: maximum duration {context.policy.maxDurationSeconds/3600} hours; up to {context.policy.maxRenewals} renewals. {context.policy.requiresSecondApproval?"An independent support administrator must approve grants.":"A second approval is not required by this policy."}</p>
    <p className="rj-caption">Fresh TOTP verification is required. If verification has expired, complete MFA in your workforce session and reload.</p>
    <form onSubmit={prepare} className="space-y-3">
     <fieldset disabled={busy||!!attempt} className="space-y-3">
      <label className="block">Recovery action<select aria-label="Recovery action" className="rj-input mt-2" value={action} onChange={e=>{setAction(e.target.value as "grant"|"revoke");clearReview()}}><option value="grant">Grant temporary access</option><option value="revoke" disabled={!context.grace}>Revoke current grace</option></select></label>
      {action==="grant"&&<label className="block">Expiry (UTC)<input className="rj-input mt-2" type="datetime-local" aria-label="Expiry (UTC)" required value={expiry} onChange={e=>{setExpiry(e.target.value);clearReview()}}/><span className="rj-caption">Enter an exact UTC time within the approved policy. The preview shows the saved expiry.</span></label>}
      <label className="block">Reason<select className="rj-input mt-2" value={reason} onChange={e=>{setReason(e.target.value);clearReview()}}><option value="payment_recovery">Payment recovery</option><option value="pilot_support">Pilot support</option></select></label>
      <p>Ticket: {ticket}</p><button className="rj-button rj-button-secondary">Preview recovery change</button>
     </fieldset>
    </form>
    <div className="space-y-3 border-t pt-4"><label className="block">Recovery review reference<input className="rj-input mt-2" value={reference} disabled={busy||!!attempt} onChange={e=>{setReference(e.target.value);clearReview()}}/></label>
     <button className="rj-button rj-button-secondary" disabled={busy||!!attempt||!reference.trim()} onClick={()=>void inspect(false)}>Load recovery review</button></div>
   </>}
   {review&&<section className="space-y-3 rounded-xl border p-4" aria-label="Recovery change preview">
    <h3 className="font-semibold">Confirm the exact change</h3><p>Organization: {review.snapshot.organizationName} · {review.organizationId}</p>
    <p>Action: {review.request.action==="grant"?"Grant temporary workspace access":"Revoke support grace"}</p>
    <p>Expiry (UTC): {review.request.expires?new Date(review.request.expires).toISOString():"Grace ends when revoked"}</p>
    <p>Ticket: {review.request.ticket} · Reason: {review.request.reason}</p><p>Review reference: <span className="break-all">{review.id}</span></p>
    <p>No invoice, trial deadline, clinical permission or record assignment changes.</p>
    <p>{approvalRequired?(review.approved?"Independent approval recorded; authority is checked again on confirmation.":"Independent approval required before confirmation."):"No independent approval required for this action."}</p>
    <p className="rj-caption">Review expires {new Date(review.validUntil).toISOString()}.</p>
    {expired&&!attempt&&<p role="alert">This review has expired. Prepare a new review.</p>}
    {attempt&&<p role="status">Keep this review open. Retry the same confirmation if its result was interrupted.</p>}
    <div className="flex flex-wrap gap-3">
     {review.actorId===context.userId&&<button className="rj-button rj-button-primary" disabled={busy||(!attempt&&(expired||review.confirmed||!!approvalRequired&&!review.approved))} onClick={()=>void confirm()}>{attempt?"Retry confirmation":"Confirm recovery change"}</button>}
     {context.role==="administrator"&&review.actorId!==context.userId&&approvalRequired&&!review.approved&&<button className="rj-button rj-button-primary" disabled={busy||expired||!!attempt} onClick={()=>void inspect(true)}>Approve this recovery</button>}
     <button className="rj-button rj-button-secondary" disabled={busy||!!attempt} onClick={clearReview}>Discard review</button>
    </div>
   </section>}
  </>}
  <button className="underline" disabled={busy||!!attempt} onClick={()=>{clearReview();void load()}}>Reload recovery state</button>
 </section>
}
