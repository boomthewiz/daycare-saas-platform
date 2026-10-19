"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
type Task={id:string;title:string;description:string|null;completed:boolean;due_at:string|null;client_name:string|null;legacy_reference:boolean;legacy_date_only:boolean}
type Result={organizationId:string;userId:string;date:string;timezone:string;manager:boolean;canWrite:boolean;rows:Task[];hasMore:boolean}
export default function TasksWorkspace(){
 const {data:caps}=useEffectiveCapabilities()
 const [date,setDate]=useState(""),[page,setPage]=useState(0),[data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("")
 const generation=useRef(0),scope=caps?`${caps.organizationId}:${caps.userId}`:""
 const load=useCallback(async()=>{
  const request=++generation.current;setData(null);setError("");setBusy(false)
  if(!scope)return
  setBusy(true)
  try{
   const result=await supabase.rpc("task_workspace",{p_date:date||null,p_page:page})
   if(request!==generation.current)return
   if(result.error||!result.data||!Array.isArray(result.data.rows))throw new Error(result.error?.message||"Unexpected task response")
   if(result.data.organizationId!==caps?.organizationId||result.data.userId!==caps?.userId)throw new Error("Account changed; reload access")
   setData(result.data)
  }catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:"Unable to load tasks")}
  finally{if(request===generation.current)setBusy(false)}
 },[scope,date,page,caps?.organizationId,caps?.userId])
 useEffect(()=>{
  const counter=generation;void load()
  const refresh=()=>{if(!document.hidden)void load()}
  const device=(event:Event)=>{if((event as CustomEvent<string>).detail==="unlocked")void load();else{counter.current++;setData(null);setBusy(false)}}
  const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{counter.current++;setData(null);window.setTimeout(refresh,0)})
  window.addEventListener("focus",refresh);window.addEventListener("rejoyce:device-state",device)
  return()=>{counter.current++;subscription.unsubscribe();window.removeEventListener("focus",refresh);window.removeEventListener("rejoyce:device-state",device)}
 },[load])
 return <main className="mx-auto max-w-4xl space-y-4 p-5"><h1 className="rj-heading-1">Tasks</h1>
  <p>Assigned staff see their tasks; authorized child/scheduling managers see organization tasks. This page does not establish daily-care completion or D5 reporting completeness.</p>
  <label className="block">Organization-local task date<input className="rj-input" type="date" value={date||data?.date||""} onChange={e=>{setDate(e.target.value);setPage(0)}}/></label>
  <button className="rj-button rj-button-secondary" disabled={busy} onClick={()=>void load()}>Refresh tasks</button>
  {busy&&<p role="status">Loading tasks…</p>}{error&&<p role="alert">Tasks unverified: {error}. <button className="underline" onClick={()=>void load()}>Retry tasks</button> {caps?.sessions&&<Link className="underline" href="/reports">Review reporting timezone</Link>}</p>}
  {data&&data.organizationId===caps?.organizationId&&data.userId===caps?.userId&&<><p>{data.date} · {data.timezone} · {data.manager?"Organization tasks":"My assigned tasks"} · Page {page+1}</p>
   {!data.rows.length&&<p>No matching recorded tasks on this page. This does not establish that all care work is complete.</p>}
   {data.rows.map(task=><article className="rj-card space-y-2 p-4" key={task.id}><h2 className="rj-heading-3">{task.title}</h2>{task.description&&<p>{task.description}</p>}{task.client_name&&<p>Client: {task.client_name}</p>}
    {task.legacy_reference&&<p>Legacy child/classroom reference retained; no current client or classroom membership is inferred.</p>}
    <p>{task.legacy_date_only?"Legacy date-only task; original timezone not recorded":task.due_at?new Date(task.due_at).toLocaleString(undefined,{timeZone:data.timezone}):"No due time"}</p><p>{task.completed?"Recorded complete":"Pending"}</p>
    <button className="rj-button rj-button-secondary" disabled={busy||!data.canWrite} onClick={async()=>{
     const request=++generation.current;setBusy(true);setError("")
     try{const result=await supabase.rpc("set_task_completed",{p_task:task.id,p_expected:task.completed,p_completed:!task.completed});if(request!==generation.current)return;if(result.error)throw new Error(result.error.message);await load()}
     catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:"Task update was not confirmed")}
     finally{if(request===generation.current)setBusy(false)}
    }}>{task.completed?"Mark pending":"Record completion"}</button>
   </article>)}
   <nav aria-label="Task pages"><button disabled={busy||!page} onClick={()=>setPage(p=>p-1)}>Previous tasks</button> · <button disabled={busy||!data.hasMore} onClick={()=>setPage(p=>p+1)}>Next tasks</button></nav>
  </>}
 </main>
}
