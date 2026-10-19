"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { organizationLocalTime } from "@/lib/organization-local-time"
import Link from "next/link"
import AttendanceActivation from "@/components/AttendanceActivation"
import { supabase } from "@/lib/supabase"
import { csvCell } from "@/lib/operational-reports"
type Branch = { id: string; name: string; active: boolean }
type Context = { organizationId: string; userId: string; view: boolean; record: boolean; correct: boolean; reports: boolean; canWrite: boolean; timezone: string | null; branches: Branch[]; staff: { id: string; name: string }[]; scopes: {user_id: string; branch_id: string}[] }
type Visit = { id: string; child_id: string; name: string; branch_id: string; branch_name: string; check_in: string; check_out: string | null; version: number; timezone: string; open_visit: boolean; carry_in: boolean; voided: boolean }
type ReadResult = { asOf: string; timezone: string; page: number; hasMore: boolean; rows: Visit[]; children: {id: string; name: string}[] }
type History = { version: number; action: string; check_in: string; check_out: string | null; branch_name: string; reason: string | null; actor_id: string; recorded_at: string }
export default function AttendanceWorkspace() {
  const [context, setContext] = useState<Context | null>(null)
  const [branch, setBranch] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [openOnly, setOpenOnly] = useState(true)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{key: string; value: ReadResult} | null>(null)
  const [child, setChild] = useState("")
  const [editing, setEditing] = useState<Visit | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [correctBranch, setCorrectBranch] = useState("")
  const [inOptions,setInOptions]=useState<string[]>([]),[outOptions,setOutOptions]=useState<string[]>([])
  const [inInstant,setInInstant]=useState(""),[outInstant,setOutInstant]=useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [staff, setStaff] = useState("")
  const [scopes, setScopes] = useState<string[]>([])
  const [activationRevision, setActivationRevision] = useState(0)
  const generation = useRef(0)
  const operation = useRef<{key: string; id: string} | null>(null)
  const key = JSON.stringify([context?.organizationId,context?.userId,branch,from,to,openOnly,search,page])
  const current = data?.key === key ? data.value : null
  const loadContext = useCallback(async () => {
    const request = ++generation.current
    setContext(null); setData(null); setEditing(null); setStaff(""); setScopes([]); setError(""); setBusy(false)
    try {
      const result = await supabase.rpc("attendance_context")
      if (request !== generation.current) return
      if (result.error || !result.data || !Array.isArray(result.data.branches)) throw new Error("Unable to verify attendance access. Unlock your device and retry.")
      const next = result.data as Context
      setContext(next)
      setActivationRevision(previous => previous + 1)
      setBranch(previous => next.branches.some(item => item.id === previous) ? previous : next.branches[0]?.id || "")
      if (next.timezone) {
        const parts = new Intl.DateTimeFormat("en-CA",{timeZone:next.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
        const today = ["year","month","day"].map(type=>parts.find(part=>part.type===type)?.value).join("-")
        setFrom(previous=>previous||today); setTo(previous=>previous||today)
      }
    } catch(cause) { if(request===generation.current)setError(cause instanceof Error?cause.message:"Unable to load attendance.") }
  },[])
  useEffect(()=>{
    const counter=generation
    void loadContext()
    const device=(event: Event)=>{
      if((event as CustomEvent<string>).detail==="unlocked")void loadContext()
      else {counter.current++;setContext(null);setData(null);setEditing(null);setBusy(false)}
    }
    const refresh=()=>{if(!document.hidden)void loadContext()}
    window.addEventListener("rejoyce:device-state",device);window.addEventListener("focus",refresh)
    const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{counter.current++;setContext(null);setData(null);setEditing(null);window.setTimeout(refresh,0)})
    return ()=>{counter.current++;subscription.unsubscribe();window.removeEventListener("rejoyce:device-state",device);window.removeEventListener("focus",refresh)}
  },[loadContext])
  const read=async(exportPage=false,nextPage=page)=>{
    if(!context?.view||!branch)return
    const request=++generation.current
    const responseKey=JSON.stringify([context.organizationId,context.userId,branch,from,to,openOnly,search,nextPage])
    setBusy(true);setError("");if(!exportPage)setData(null)
    try {
      const result=await supabase.rpc("attendance_read",{p_branch:branch,p_from:from,p_to:to,p_open:openOnly,p_search:search,p_page:nextPage,p_export:exportPage})
      if(request!==generation.current)return
      if(result.error)throw new Error(result.error.message)
      const next=result.data as ReadResult
      if(!next||!Array.isArray(next.rows))throw new Error("Unexpected attendance response.")
      if(!exportPage)setData({key:responseKey,value:next})
      else {
        const rows=[["Child","Event branch","Check-in UTC","Check-out UTC","Classroom","Generated UTC","Report timezone","From","Through","Mode","Name filter","Page"],...next.rows.map(row=>[row.name,row.branch_name,row.check_in,row.check_out||"No recorded checkout","Not recorded",next.asOf,next.timezone,from,to,openOnly?"All open visits regardless of date":"Recorded visits overlapping date range",search,String(nextPage+1)])]
        const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}))
        const anchor=document.createElement("a");anchor.href=url;anchor.download=`attendance-page-${nextPage+1}.csv`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
        setNotice("Exported only this freshly authorized page. Correction reasons are excluded.")
      }
    }catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:"Attendance request failed. Retry.")}
    finally{if(request===generation.current)setBusy(false)}
  }
  const mutate=async(action:"check_in"|"check_out"|"correct"|"void",visit?:Visit)=>{
    const request=++generation.current
    setBusy(true);setError("");setNotice("")
    try{
      let resolvedIn:string|null=null,resolvedOut:string|null=null
      if(action==="correct"){
        if(!start||!visit)throw new Error("Choose a local check-in time.")
        const [a,b]=await Promise.all([supabase.rpc("attendance_local_options",{p_visit:visit.id,p_local:start}),end?supabase.rpc("attendance_local_options",{p_visit:visit.id,p_local:end}):Promise.resolve({data:{instants:[]},error:null})])
        if(request!==generation.current)return
        if(a.error||b.error)throw new Error(a.error?.message||b.error?.message)
        const starts=a.data.instants as string[],ends=b.data.instants as string[]
        setInOptions(starts);setOutOptions(ends)
        if(!starts.length||(end&&!ends.length))throw new Error("This local time does not exist because of a timezone clock change. Choose another time.")
        resolvedIn=starts.length===1?starts[0]:starts.find(value=>new Date(value).getTime()===new Date(inInstant).getTime())||null
        resolvedOut=!end?null:ends.length===1?ends[0]:ends.find(value=>new Date(value).getTime()===new Date(outInstant).getTime())||null
        if(!resolvedIn||(end&&!resolvedOut))throw new Error("This local time occurs twice. Choose the intended occurrence below, then apply again.")
      }
      const payload={p_action:action,p_child:action==="check_in"?child:null,p_branch:action==="check_in"?branch:action==="correct"?correctBranch:null,p_visit:visit?.id||null,p_version:visit?.version??null,p_in:resolvedIn,p_out:resolvedOut,p_reason:action==="correct"||action==="void"?reason:null}
      const fingerprint=JSON.stringify(payload)
      if(operation.current?.key!==fingerprint)operation.current={key:fingerprint,id:crypto.randomUUID()}
      const result=action==="correct"?await supabase.rpc("correct_attendance_local",{p_visit:visit!.id,p_version:visit!.version,p_branch:correctBranch,p_in_local:start,p_out_local:end||null,p_in_instant:resolvedIn,p_out_instant:resolvedOut,p_reason:reason,p_operation:operation.current.id}):await supabase.rpc("attendance_mutate",{...payload,p_operation:operation.current.id})
      if(request!==generation.current)return
      if(result.error)throw new Error(result.error.message)
      operation.current=null;setEditing(null);setHistory([]);setChild("");setNotice("Attendance saved and confirmed by the server.")
      await read()
    }catch(cause){if(request===generation.current)setError((cause instanceof Error?cause.message:"Unable to save.")+" Retry unchanged details to reuse the same operation ID.")}
    finally{if(request===generation.current)setBusy(false)}
  }
  const openHistory=async(visit:Visit)=>{
    const request=++generation.current;setBusy(true);setError("");setHistory([])
    try{
      const result=await supabase.rpc("attendance_history",{p_visit:visit.id})
      if(request!==generation.current)return
      if(result.error)throw new Error(result.error.message)
      setEditing(visit);setHistory(result.data);setStart(organizationLocalTime(visit.check_in,visit.timezone));setEnd(visit.check_out?organizationLocalTime(visit.check_out,visit.timezone):"");setInInstant(visit.check_in);setOutInstant(visit.check_out||"");setInOptions([]);setOutOptions([]);setCorrectBranch(visit.branch_id);setReason("")
    }catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:"History unavailable.")}
    finally{if(request===generation.current)setBusy(false)}
  }
  const change=(update:()=>void)=>{generation.current++;setBusy(false);setData(null);setEditing(null);setPage(0);setChild("");update()}
  const display=(instant:string|null)=>instant?`${new Date(instant).toLocaleString(undefined,{timeZone:context?.timezone||"UTC"})} (${context?.timezone||"UTC"})`:"No recorded checkout"
  return <div className="space-y-5"><header><h1 className="rj-heading-1">Attendance</h1><p className="mt-2">Branch-level recorded child presence. Classroom not recorded; this does not verify authorized pickup or staffing ratios.</p></header>
    {error&&<p role="alert">{error} <button className="underline" onClick={()=>void loadContext()}>Reload access</button></p>}{notice&&<p role="status">{notice}</p>}
    {!context?<button className="rj-button rj-button-secondary" onClick={()=>void loadContext()}>Load attendance access</button>:<>
      <AttendanceActivation revision={activationRevision} />
      {!context.timezone&&<p>Configure the organization reporting timezone in <Link className="underline" href="/reports">Reports</Link> before recording attendance.</p>}
      {!context.view&&<p>View attendance and separately assigned attendance branches are required. Clinical or schedule assignments do not grant attendance access.</p>}
      {!context.canWrite&&<p>Read-only access. Only eligible visits already open before editing expiry may be checked out. New visits and corrections are unavailable.</p>}
      {context.view&&<>
        <form className="rj-card grid gap-3 p-5 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();void read()}}>
          <label>Attendance branch<select className="rj-input" value={branch} onChange={event=>change(()=>setBranch(event.target.value))}><option value="">Select branch</option>{context.branches.map(item=><option key={item.id} value={item.id}>{item.name}{item.active?"":" (inactive)"}</option>)}</select></label>
          <label>Name search<input type="search" maxLength={100} className="rj-input" value={search} onChange={event=>change(()=>setSearch(event.target.value))}/></label>
          <label>From local date<input type="date" required className="rj-input" value={from} onChange={event=>change(()=>setFrom(event.target.value))}/></label><label>Through local date<input type="date" required className="rj-input" value={to} onChange={event=>change(()=>setTo(event.target.value))}/></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={openOnly} onChange={event=>change(()=>setOpenOnly(event.target.checked))}/>All open visits, including older dates</label>
          <div className="flex flex-wrap gap-3"><button className="rj-button rj-button-primary" disabled={busy||!branch||!context.timezone}>Load visits and child choices</button>{context.reports&&<button type="button" className="rj-button rj-button-secondary" disabled={busy||!current} onClick={()=>void read(true)}>Export this page</button>}</div>
        </form>
        {current&&<section className="rj-card space-y-4 p-5" aria-busy={busy}><p>Generated {current.asOf} · Page {page+1} · {current.rows.length} visits · {current.timezone}. Open means no recorded checkout, not independently verified presence.</p>
          {context.record&&context.canWrite&&<form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();void mutate("check_in")}}><label>Child for check-in<select required className="rj-input" value={child} onChange={event=>setChild(event.target.value)}><option value="">Search above or select a current child</option>{current.children.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="rj-button rj-button-primary" disabled={busy||!child||!context.branches.find(item=>item.id===branch)?.active}>Confirm check-in now</button></form>}
          <p className="text-sm">Child choices are limited to 100 matches; narrow the name search for more. No attendance change is saved automatically.</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Recorded branch visits</caption><thead><tr>{["Child","Event branch","Check-in","Check-out","Actions"].map(label=><th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{current.rows.map(visit=><tr key={visit.id}><td className="border-t p-2">{visit.name}{visit.voided&&<p>Voided — excluded from presence</p>}</td><td className="border-t p-2">{visit.branch_name}<p>Classroom not recorded</p></td><td className="border-t p-2">{display(visit.check_in)}{visit.carry_in&&<p>Carry-in from earlier date</p>}</td><td className="border-t p-2">{display(visit.check_out)}</td><td className="space-y-2 border-t p-2">{!visit.voided&&!visit.check_out&&context.record&&<button className="rj-button rj-button-secondary" disabled={busy} onClick={()=>void mutate("check_out",visit)}>Confirm check-out now</button>}{context.correct&&<button className="underline" disabled={busy} onClick={()=>void openHistory(visit)}>History / correct</button>}</td></tr>)}</tbody></table></div>
          {current.rows.length===0&&<p>No matching recorded visits. This does not establish absence.</p>}<div className="flex gap-3"><button className="rj-button rj-button-secondary" disabled={busy||page===0} onClick={()=>{setPage(page-1);void read(false,page-1)}}>Previous</button><button className="rj-button rj-button-secondary" disabled={busy||!current.hasMore} onClick={()=>{setPage(page+1);void read(false,page+1)}}>Next page</button></div><p className="text-sm">Pages and exports are fresh independent snapshots. Historical views include voided records for correction staff; exports exclude them.</p>
        </section>}
        {editing&&<section className="rj-card space-y-3 p-5" aria-label="Attendance correction"><h2 className="rj-heading-2">History for {editing.name}</h2><ol className="list-decimal space-y-2 pl-5">{history.map(event=><li key={event.version}>Version {event.version}: {event.action} · {event.branch_name} · recorded {event.recorded_at} · actor {event.actor_id}<p>Effective: {event.check_in} → {event.check_out||"open"}</p>{event.reason&&<p>Reason: {event.reason}</p>}</li>)}</ol>
          <p>Corrections preserve original history and require original and replacement check-in dates within seven local dates in {editing.timezone}. Enter civil times in the recorded organization timezone. Nonexistent clock-change times are rejected; repeated times require an explicit occurrence.</p>
          <label className="block">Corrected branch<select className="rj-input" value={correctBranch} onChange={event=>setCorrectBranch(event.target.value)}>{context.branches.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="block">Check-in local time<input type="datetime-local" step="1" className="rj-input" value={start} onChange={event=>{setStart(event.target.value);setInInstant("");setInOptions([])}}/></label><label className="block">Check-out local time (blank means open)<input type="datetime-local" step="1" className="rj-input" value={end} onChange={event=>{setEnd(event.target.value);setOutInstant("");setOutOptions([])}}/></label>
          {inOptions.length>1&&<label className="block">Check-in occurrence<select className="rj-input" value={inInstant} onChange={event=>setInInstant(event.target.value)}><option value="">Choose the intended occurrence</option>{inOptions.map(value=><option key={value} value={value}>{value} (UTC)</option>)}</select></label>}
          {outOptions.length>1&&<label className="block">Checkout occurrence<select className="rj-input" value={outInstant} onChange={event=>setOutInstant(event.target.value)}><option value="">Choose the intended occurrence</option>{outOptions.map(value=><option key={value} value={value}>{value} (UTC)</option>)}</select></label>}
          <label className="block">Correction or void reason<input className="rj-input" maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>
          <div className="flex flex-wrap gap-3"><button className="rj-button rj-button-primary" disabled={busy||editing.voided||!context.canWrite||reason.trim().length<3} onClick={()=>void mutate("correct",editing)}>Apply reasoned correction</button><button className="rj-button rj-button-danger" disabled={busy||editing.voided||!context.canWrite||reason.trim().length<3} onClick={()=>void mutate("void",editing)}>Void this visit, preserve history</button><button className="underline" onClick={()=>setEditing(null)}>Close history</button></div>
        </section>}
      </>}
      {!!context.staff.length&&<details id="attendance-branch-access" className="rj-card space-y-3 p-5"><summary className="cursor-pointer font-semibold">Administer attendance branch access</summary><p>Grant attendance permissions in the account editor separately. These branch assignments do not change clinical or classroom access.</p><label className="block">Staff account<select className="rj-input" value={staff} onChange={event=>{setStaff(event.target.value);setScopes(context.scopes.filter(item=>item.user_id===event.target.value).map(item=>item.branch_id))}}><option value="">Select staff</option>{context.staff.map(item=><option key={item.id} value={item.id}>{item.name||item.id}</option>)}</select></label>
        {context.branches.map(item=><label key={item.id} className="flex gap-2"><input type="checkbox" checked={scopes.includes(item.id)} onChange={event=>setScopes(previous=>event.target.checked?[...previous,item.id]:previous.filter(id=>id!==item.id))}/>{item.name}</label>)}
        <button className="rj-button rj-button-secondary" disabled={busy||!staff||!context.canWrite} onClick={async()=>{
          const request=++generation.current;setBusy(true);setError("")
          try{const result=await supabase.rpc("set_attendance_scope",{p_user:staff,p_branches:scopes,p_expected:context.scopes.filter(item=>item.user_id===staff).map(item=>item.branch_id)});if(request!==generation.current)return;if(result.error)throw new Error(result.error.message);setNotice("Attendance branch access saved.");await loadContext()}
          catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:"Unable to save attendance branches.")}
          finally{if(request===generation.current)setBusy(false)}}}>Save attendance branches</button>{staff&&<Link href={`/team-management/${staff}`} className="ml-3 underline">Review account grants</Link>}
      </details>}
    </>}
  </div>
}
