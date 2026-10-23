"use client"

import { readGroupActivities } from "@/lib/activity-groups"
import { usePortal } from "@/components/PortalProvider"
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Row = { id:string; workflow_intent?:string; status:string; scheduled_start:string|null; completed_at:string|null; clients:{first_name:string;preferred_name:string|null}|null; session_notes:{status:string}|null }
export default function SessionHistoryPage() {
  const { t } = usePortal()

  const [groups,setGroups]=useState<{id:string;activity_title:string;scheduled_start:string}[]>([])
  const [rows,setRows]=useState<Row[]>([])
  const [filter,setFilter]=useState('all')
  const [page,setPage]=useState(0)
  const [more,setMore]=useState(false)
  const [busy,setBusy]=useState(true)
  const [error,setError]=useState<string|null>(null)
  const load=useCallback(async()=>{
    setBusy(true);setError(null)
    try {
      const auth=await supabase.auth.getUser()
      if(auth.error||!auth.data.user) throw new Error('Sign in to see your session history.')
      let query=supabase.from('sessions').select('id,workflow_intent,status,scheduled_start,completed_at,clients(first_name,preferred_name),session_notes(status)')
        .eq('provider_id',auth.data.user.id)
      query=filter==='all' ? query.in('status',['completed','canceled','client_absent','provider_absent','no_show']) : query.eq('status',filter)
      const result=await query.order('scheduled_start',{ascending:false,nullsFirst:false}).order('id').range(page*25,page*25+24)
      if(result.error) throw result.error
      setGroups((await readGroupActivities({assigned:true})).filter(row=>row.status==="canceled" && ["all","canceled"].includes(filter)))
      setRows(result.data as unknown as Row[]);setMore(result.data.length===25)
    } catch(cause) { setRows([]);setGroups([]);setMore(false);setError(cause instanceof Error?cause.message:'Unable to load history. Try again.') }
    finally {setBusy(false)}
  },[page,filter])
  useEffect(()=>{void load()},[load])
  return <main className="mx-auto max-w-3xl space-y-5 py-3 sm:p-6">
    <Link href="/my-sessions" className="rj-button rj-button-secondary">{t("Back to my sessions")}</Link>
    <h1 className="rj-heading-1">{t("Session history")}</h1>
    <label className="block">{t("Session outcome")}<select className="rj-input mt-2" value={filter} disabled={busy} onChange={e=>{setFilter(e.target.value);setPage(0)}}>{['all','completed','canceled','client_absent','provider_absent','no_show'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
    {!!groups.length && <section className="space-y-3"><h2 className="rj-heading-2">Canceled group activities</h2>{groups.map(group=><Link className="rj-card block p-4" key={group.id} href={`/activity/${group.id}`}>{group.activity_title} · {new Date(group.scheduled_start).toLocaleString()}</Link>)}</section>}
    {error && <div role="alert">{error}<button className="rj-button rj-button-secondary" onClick={()=>void load()}>Try again</button></div>}
    {busy ? <p role="status">Loading history…</p> : <>
      {!rows.length&&!error&&<p>{t("No sessions match this page.")}</p>}
      {rows.map(row=><Link key={row.id} href={row.workflow_intent === "activity" ? `/activity/${row.id}` : `/session/${row.id}/complete`} className="rj-card block p-5">
        <h2 className="rj-heading-3">{row.clients?.preferred_name||row.clients?.first_name||'Session'}</h2>
        <p>{row.scheduled_start?new Date(row.scheduled_start).toLocaleString():'Unscheduled'} · {row.status.replaceAll('_',' ')}</p>
        <p>{row.workflow_intent === 'activity' ? 'Ordinary activity — no clinical note required' : `Note: ${row.session_notes?.status || 'not created'}`}</p>
      </Link>)}
    </>}
    <nav aria-label="History pages" className="flex flex-wrap items-center gap-3"><button className="rj-button rj-button-secondary" disabled={busy||page===0} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page+1}</span><button className="rj-button rj-button-secondary" disabled={busy||!more} onClick={()=>setPage(value=>value+1)}>Next</button></nav>
  </main>
}
