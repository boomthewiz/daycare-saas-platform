"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { launchPlan } from "@/lib/subscription-plan"

export default function OwnerOnboardingPage() {
 const [step,setStep]=useState<"email"|"code"|"organization">("email")
 const [email,setEmail]=useState(""),[code,setCode]=useState("")
 const [name,setName]=useState(""),[fullName,setFullName]=useState(""),[branchName,setBranchName]=useState(""),[organizationType,setOrganizationType]=useState("")
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[resendAt,setResendAt]=useState(0),[remaining,setRemaining]=useState(0)
 useEffect(()=>{
  const tick=()=>setRemaining(Math.max(0,Math.ceil((resendAt-Date.now())/1000)))
  tick();const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer)
 },[resendAt])
 useEffect(()=>{
  let active=true
  void (async()=>{
   const {data:{session}}=await supabase.auth.getSession()
   if(!session)return
   const response=await fetch("/api/device-session",{headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"})
   const result=await response.json()
   if(active&&response.ok&&["setup","unlocked"].includes(result.state)&&result.canSetPin){setEmail(session.user.email||"");setStep("organization")}
  })().catch(()=>{})
  return()=>{active=false}
 },[])
 async function perform(action:"send"|"verify"|"create"){
  if(busy||(action==="send"&&remaining>0))return
  setBusy(true);setError("")
  try{
   const {data:{session}}=await supabase.auth.getSession()
   const response=await fetch(action==="verify"?"/api/email-login/verify":"/api/organization-signup",{
    method:"POST",headers:{"Content-Type":"application/json",...(action==="create"&&session?{Authorization:"Bearer "+session.access_token}:{})},
    body:JSON.stringify(action==="verify"?{email,code}:{action,email,name,fullName,branchName,organizationType})
   })
   const result=await response.json()
   if(!response.ok)throw new Error(result.error||"Unable to continue. Please try again.")
   if(action==="send"){setEmail(email.trim().toLowerCase());setStep("code");setCode("");setResendAt(Date.now()+60000)}
   else if(action==="verify"){
    const {error:sessionError}=await supabase.auth.setSession(result.session)
    if(sessionError)throw new Error("Unable to save your sign-in. Request a new code.")
    if(result.hasOrganization)window.location.assign(result.state==="setup"?"/set-pin":"/dashboard")
    else setStep("organization")
   }else window.location.assign(result.destination)
  }catch(cause){setError(cause instanceof Error?cause.message:"Unable to continue.")}
  finally{setBusy(false)}
 }
 return <main className="min-h-screen bg-slate-50 px-4 py-10"><section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 sm:p-9 shadow-sm">
  <p className="font-semibold text-teal-700">ReJoyce</p><h1 className="mt-3 text-3xl font-bold text-slate-900">Create your organization</h1>
  <p className="mt-3 text-slate-600">{launchPlan.trialDays} days free. No credit card required. You become the owner of your organization.</p>
  <p className="mt-3 text-sm text-slate-600">Then $79 USD/month including one service provider, plus $29 per additional provider. Administrative-only accounts are included. You choose when to subscribe.</p>
  <p className="mt-2 text-sm text-slate-600">Without a subscription, your records remain available to read after the trial.</p>
  <form className="mt-7 space-y-4" onSubmit={event=>{event.preventDefault();void perform(step==="email"?"send":step==="code"?"verify":"create")}}>
   {step==="email"&&<label className="block text-sm font-medium">Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy} className="rj-input mt-2 w-full"/></label>}
   {step==="code"&&<><p className="text-sm text-slate-600">Enter the email code sent to {email}.</p><label className="block text-sm font-medium">Email code<input required autoComplete="one-time-code" inputMode="numeric" pattern="([0-9]{6}|[0-9]{8})" maxLength={8} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} disabled={busy} className="rj-input mt-2 w-full"/></label></>}
   {step==="organization"&&<>
    <p className="text-sm text-teal-800">Email verified: {email}</p>
    <label className="block text-sm font-medium">Your full name<input required autoComplete="name" maxLength={160} value={fullName} onChange={e=>setFullName(e.target.value)} disabled={busy} className="rj-input mt-2 w-full"/></label>
    <label className="block text-sm font-medium">Organization name<input required autoComplete="organization" maxLength={160} value={name} onChange={e=>setName(e.target.value)} disabled={busy} className="rj-input mt-2 w-full"/></label>
    <label className="block text-sm font-medium">Organization type<select required value={organizationType} onChange={e=>setOrganizationType(e.target.value)} disabled={busy} className="rj-input mt-2 w-full"><option value="">Select type</option>{["Childcare Center","School","Therapy Practice","Assisted Living","Healthcare","Other"].map(type=><option key={type}>{type}</option>)}</select></label>
    <label className="block text-sm font-medium">First branch name<input required maxLength={160} value={branchName} onChange={e=>setBranchName(e.target.value)} disabled={busy} placeholder="For example, Main location" className="rj-input mt-2 w-full"/></label>
    <p className="text-sm text-slate-500">Your trial starts when your organization is created. You can add more branches and invite staff from your workspace.</p>
   </>}
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
   <button disabled={busy} className="rj-button rj-button-primary w-full">{busy?"Please wait…":step==="email"?"Send verification code":step==="code"?"Verify email":"Create organization and start trial"}</button>
  </form>
  {step==="code"&&<div className="mt-4 flex flex-col gap-3 text-sm"><button disabled={busy||remaining>0} onClick={()=>void perform("send")} className="text-teal-800 underline disabled:opacity-50">{remaining?"Resend in "+remaining+"s":"Resend code"}</button><button disabled={busy} onClick={()=>{setStep("email");setCode("");setError("")}} className="underline">Use a different email</button></div>}
  <p className="mt-7 text-center text-sm text-slate-600">Already have an organization? <Link href="/login" className="text-teal-800 underline">Sign in</Link></p>
 </section></main>
}
