"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import SearchableChoice from "@/components/SearchableChoice"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
export type SavedSessionChoice={id:string;kind:"tag"|"location";label:string;domain:"shared"|"daycare"|"care_services"|"aba";active?:boolean;version?:number}
export type RecentSessionChoice={id:string;child_id:string;provider_id:string;session_type:string;location:string|null;tag_ids:string[];duration_minutes:number;workflow_intent?:"activity"|"clinical"}
export type SessionContext={organizationId:string;userId:string;choices:SavedSessionChoice[];recent:RecentSessionChoice[];tags:{id:string;label:string;domain:string}[]}
export function useSessionContext(enabled:boolean,sessionId?:string,selectedIds:string[]=[]){
 const {data:caps}=useEffectiveCapabilities()
 const scope=enabled&&caps?.sessions?`${caps.organizationId}:${caps.userId}:${sessionId||"create"}`:""
 const selectedKey=JSON.stringify(selectedIds)
 const [saved,setSaved]=useState<{scope:string;data:SessionContext}|null>(null),[error,setError]=useState("")
 const generation=useRef(0)
 const refresh=useCallback(async(ids?:string[])=>{if(!scope)return;const request=++generation.current;const result=await supabase.rpc("session_context_v2",{p_session:sessionId||null,p_selected:ids||JSON.parse(selectedKey),p_location:null});if(request!==generation.current)return null;if(result.error){setSaved(null);setError(result.error.message);return null}setError("");setSaved({scope,data:result.data as SessionContext});return result.data as SessionContext},[scope,sessionId,selectedKey])
 useEffect(()=>{const counter=generation;const request=++counter.current;if(scope)void supabase.rpc("session_context_v2",{p_session:sessionId||null,p_selected:JSON.parse(selectedKey),p_location:null}).then(result=>{if(request!==counter.current)return;if(result.error){setSaved(null);setError(result.error.message)}else{setError("");setSaved({scope,data:result.data as SessionContext})}});return()=>{counter.current++}},[scope,sessionId,selectedKey])
 return {data:scope&&saved?.scope===scope?saved.data:null,error:scope?error:"",refresh}
}
export default function SessionContextChoices({context,selected,onChange,onSaved,disabled}:{context:SessionContext|null;selected:string[];onChange:(ids:string[])=>void;onSaved:(ids?:string[])=>Promise<SessionContext|null|undefined>;disabled:boolean}){
 const [domain,setDomain]=useState("shared")
 const tags=context?.choices.filter(choice=>choice.kind==="tag")||[]
 return <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">Optional activity tags</h3><p className="text-sm">Reuse saved labels from your organization. Tags describe context; they do not grant access, record attendance, verify parent training or measure treatment progress.</p>
  <label className="block">New tag category<select className="rj-input" value={domain} disabled={disabled} onChange={event=>setDomain(event.target.value)}><option value="shared">Shared activity context</option><option value="daycare">Daycare context</option><option value="care_services">Client-care context</option><option value="aba">ABA context</option></select></label>
  <SearchableChoice key={selected.join(":")} label="Activity tag" savedKind="tag" value="" disabled={disabled||selected.length>=20} options={tags.filter(tag=>tag.active!==false&&!selected.includes(tag.id)).map(tag=>({value:tag.id,label:tag.label,recent:!!context?.recent.some(recent=>recent.tag_ids.includes(tag.id))}))} onChange={id=>onChange([...new Set([...selected,id])])} createLabel="Create and save tag" onCreate={async label=>{const result=await supabase.rpc("save_session_choice",{p_kind:"tag",p_label:label,p_domain:domain});if(result.error)throw new Error(result.error.message);await onSaved([...selected,result.data as string]);onChange([...new Set([...selected,result.data as string])])}}/>
  <ul className="flex flex-wrap gap-2">{selected.map(id=><li key={id} className="rounded-full border px-3 py-2 text-sm">{(tags.find(tag=>tag.id===id)?.active===false?"Archived: ":"")+(tags.find(tag=>tag.id===id)?.label||"Unavailable tag — reload choices")} ({tags.find(tag=>tag.id===id)?.domain||"unknown"}) <button type="button" className="ml-2 underline" disabled={disabled} onClick={()=>onChange(selected.filter(value=>value!==id))}>Remove</button></li>)}</ul>
  <p className="text-sm">Examples you may choose to save: “Parent observed” or “Parent-led practice” under ABA/client-care context; “Outdoor play” under daycare context. Nothing is created automatically.</p>
 </section>
}
