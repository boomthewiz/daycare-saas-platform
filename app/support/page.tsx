"use client"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { supabase } from "@/lib/supabase"
type Organization = { id: string; name: string; model: string; modelVersion: number; abaEnabled: boolean; moduleVersion: number }
export default function SupportPage() {
 const [query,setQuery] = useState("")
 const [ticket,setTicket] = useState("")
 const [version,setVersion] = useState(1)
 const [organizations,setOrganizations] = useState<Organization[]>([])
 const [message,setMessage] = useState("")
 const [busy,setBusy] = useState(false)
 const sequence = useRef(0)
 useEffect(() => {
  const counter=sequence
  const clear = () => { counter.current++;setOrganizations([]);setMessage("");setBusy(false) }
  const {data:{subscription}} = supabase.auth.onAuthStateChange(clear)
  window.addEventListener("rejoyce:device-state",clear)
  window.addEventListener("blur",clear)
  return () => {counter.current++;subscription.unsubscribe();window.removeEventListener("rejoyce:device-state",clear);window.removeEventListener("blur",clear)}
 },[])
 async function lookup(event: FormEvent) {
  event.preventDefault();const request=++sequence.current
  setBusy(true);setOrganizations([]);setMessage("")
  try {
   const {data,error} = await supabase.rpc("support_organization_lookup",{p_query:query,p_ticket:ticket,p_workforce_version:version})
   if(request!==sequence.current)return
   if(error || !Array.isArray(data?.organizations))throw new Error()
   setOrganizations(data.organizations);setMessage(data.organizations.length ? "Audited metadata lookup completed." : "No matching organizations.")
  } catch { if(request===sequence.current)setMessage("Support access could not be verified. Check workforce membership/version, MFA and device unlock, then retry.") }
  finally { if(request===sequence.current)setBusy(false) }
 }
 return <main className="mx-auto max-w-4xl space-y-6 p-6">
  <h1 className="rj-heading-1">ReJoyce support</h1>
  <p>Internal workforce access. Organization metadata only. Use your individually enrolled account with MFA and an unlocked device.</p>
  <form onSubmit={lookup} className="rj-card space-y-4 p-5">
   <label className="block">Organization ID or name prefix<input className="rj-input mt-2" required minLength={3} maxLength={100} value={query} onChange={e=>{setQuery(e.target.value);sequence.current++;setOrganizations([]);setBusy(false)}} /></label>
   <label className="block">Ticket reference<input className="rj-input mt-2" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,63}" value={ticket} onChange={e=>setTicket(e.target.value)} /><span className="rj-caption">Reference only; do not enter customer or clinical narrative.</span></label>
   <label className="block">Workforce membership version<input className="rj-input mt-2" type="number" required min={1} step={1} value={version} onChange={e=>setVersion(Number(e.target.value))} /></label>
   <button className="rj-button rj-button-primary" disabled={busy}>Look up organization</button>
  </form>
  <p role="status">{message}</p>
  {organizations.map(org=><article className="rj-card space-y-2 p-5" key={org.id}>
   <h2 className="rj-heading-2">{org.name}</h2><p>{org.id}</p>
   <dl><dt>Service model</dt><dd>{org.model} (version {org.modelVersion})</dd><dt>ABA configuration</dt><dd>{org.abaEnabled ? "Enabled" : "Disabled"} (version {org.moduleVersion})</dd></dl>
   <button className="rj-button rj-button-secondary" onClick={()=>{sequence.current++;setQuery(org.id);setOrganizations([]);setMessage("Submit the exact ID to refresh this organization detail.")}}>Select organization detail</button>
  </article>)}
 </main>
}
