"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import type { SavedSessionChoice } from "@/components/SessionContextChoices"
export default function SessionChoiceManager({onChanged}:{onChanged:()=>void}) {
 const {data:caps}=useEffectiveCapabilities()
 const [open,setOpen]=useState(false),[kind,setKind]=useState("tag"),[query,setQuery]=useState(""),[page,setPage]=useState(0)
 const [rows,setRows]=useState<SavedSessionChoice[]>([]),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("")
 const [editing,setEditing]=useState<string|null>(null),[label,setLabel]=useState("")
 const [loadedKey,setLoadedKey]=useState("")
 const generation=useRef(0)
 const scope=caps?.sessions?`${caps.organizationId}:${caps.userId}`:""
 const key=JSON.stringify([scope,kind,query,page])
 const load=useCallback(async()=>{
  const request=++generation.current;setRows([]);setError("");setMore(false)
  if(!scope||!open)return
  setBusy(true)
  const result=await supabase.rpc("search_session_choices",{p_kind:kind,p_query:query,p_page:page,p_archived:true})
  if(request!==generation.current)return
  setBusy(false)
  if(result.error){setError(result.error.message);return}
  setRows(result.data.rows);setMore(result.data.hasMore===true);setLoadedKey(key)
 },[scope,open,kind,query,page,key])
 useEffect(()=>{const counter=generation;const timer=window.setTimeout(()=>void load(),150);return()=>{counter.current++;window.clearTimeout(timer)}},[load])
 const change=async(row:SavedSessionChoice,action:string)=>{
  const request=++generation.current;setBusy(true);setError("");setNotice("")
  const result=await supabase.rpc("update_session_choice",{p_choice:row.id,p_version:row.version,p_action:action,p_label:action==="rename"?label:null})
  if(request!==generation.current)return
  setBusy(false)
  if(result.error){setError(result.error.message);return}
  setEditing(null);setNotice("Choice saved. Historical snapshots were retained.");onChanged();await load()
 }
 if(!scope)return null
 return <details className="rj-card space-y-3 p-4" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Manage saved tags and locations</summary>
  <p>Review duplicates before renaming, archiving or restoring. Names are unique by kind across active and archived choices. Archived choices keep their identity and historical snapshots; creating the same name again requires restoring that choice.</p>
  <label className="block">Choice kind<select className="rj-input" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);setEditing(null)}}><option value="tag">Tags</option><option value="location">Locations</option></select></label>
  <label className="block">Search active and archived choices<input className="rj-input" type="search" maxLength={120} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);setEditing(null)}}/></label>
  {error&&<p role="alert">{error} <button className="underline" onClick={()=>void load()}>Reload choices</button></p>}{notice&&<p role="status">{notice}</p>}
  {(loadedKey===key?rows:[]).map(row=><div className="rounded border p-3" key={row.id}><p>{row.label} · {row.domain} · {row.active?"Active":"Archived"}</p>
   {editing===row.id?<label className="block">Replacement label<input className="rj-input" maxLength={120} value={label} onChange={e=>setLabel(e.target.value)}/><button className="underline" disabled={busy||!caps?.canWrite||!label.trim()} onClick={()=>void change(row,"rename")}>Save name</button> <button onClick={()=>setEditing(null)}>Cancel rename</button></label>:<button className="underline mr-4" disabled={busy||!caps?.canWrite} onClick={()=>{setEditing(row.id);setLabel(row.label)}}>Rename {row.label}</button>}
   <button className="underline" disabled={busy||!caps?.canWrite} onClick={()=>void change(row,row.active?"archive":"restore")}>{row.active?"Archive":"Restore"} {row.label}</button>
  </div>)}
  {!busy&&!rows.length&&<p>No matching choices.</p>}<nav aria-label="Saved-choice pages"><button disabled={busy||!page} onClick={()=>setPage(p=>p-1)}>Previous choices</button> · Page {page+1} · <button disabled={busy||!more} onClick={()=>setPage(p=>p+1)}>Next choices</button></nav>
 </details>
}
