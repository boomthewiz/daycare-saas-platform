"use client"
import { useId, useState } from "react"
export type ChoiceOption={value:string;label:string;recent?:boolean}
/** Native searchable suggestions retain keyboard/mobile alternatives via explicit result buttons. */
export default function SearchableChoice({label,value,options,onChange,onCreate,createLabel,disabled=false,required=false}:{label:string;value:string;options:ChoiceOption[];onChange:(value:string)=>void;onCreate?:(label:string)=>Promise<void>;createLabel?:string;disabled?:boolean;required?:boolean}){
 const id=useId(),[query,setQuery]=useState(""),[open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("")
 const selected=options.find(option=>option.value===value)
 const matches=options.filter(option=>option.label.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>Number(!!b.recent)-Number(!!a.recent)||a.label.localeCompare(b.label)).slice(0,20)
 const exact=options.some(option=>option.label.trim().toLowerCase()===query.trim().toLowerCase())
 return <div className="relative space-y-2" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)){setOpen(false);setQuery("")}}}><label htmlFor={id} className="block font-semibold">{label}</label><input id={id} type="search" className="rj-input" disabled={disabled||saving} required={required&&!selected} value={open?query:selected?.label||""} placeholder={`Search ${label.toLowerCase()}`} autoComplete="off" onFocus={()=>{setOpen(true);setQuery("")}} onChange={event=>{setQuery(event.target.value);setOpen(true);if(value)onChange("")}} onKeyDown={event=>{if(event.key==="Escape"){setOpen(false);setQuery("")}}}/>
  {open&&!disabled&&<div className="max-h-64 space-y-1 overflow-auto rounded-xl border bg-white p-2" aria-label={`${label} choices`}>
   {matches.map(option=><button key={option.value} type="button" className="block min-h-11 w-full rounded p-2 text-left hover:bg-slate-100 focus-visible:outline-2" onClick={()=>{onChange(option.value);setOpen(false);setQuery("")}}>{option.label}{option.recent&&<span className="ml-2 text-xs text-teal-800">Recently selected</span>}</button>)}
   {!matches.length&&<p>No saved matches. Refine the search or use the create action if your access allows it.</p>}
   {onCreate&&query.trim()&&!exact&&<button type="button" className="rj-button rj-button-secondary" disabled={saving} onClick={async()=>{setSaving(true);setError("");try{await onCreate(query.trim());setOpen(false);setQuery("")}catch(cause){setError(cause instanceof Error?cause.message:"Unable to save choice.")}finally{setSaving(false)}}}>{saving?"Saving…":`${createLabel||"Create and save"}: ${query.trim()}`}</button>}
   <button type="button" className="block min-h-11 underline" onClick={()=>{setOpen(false);setQuery("")}}>Close suggestions</button>
  </div>}
  {selected&&<p className="text-sm">Selected: {selected.label}</p>}{error&&<p role="alert">{error}</p>}
 </div>
}
