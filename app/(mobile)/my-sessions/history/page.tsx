"use client"
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Row = { id:string; status:string; scheduled_start:string|null; completed_at:string|null; clients:{first_name:string;preferred_name:string|null}|null; session_notes:{status:string}|null }
export default function SessionHistoryPage() {
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
      let query=supabase.from('sessions').select('id,status,scheduled_start,completed_at,clients(first_name,preferred_name),session_notes(status)')
        .eq('provider_id',auth.data.user.id)
      query=filter==='all' ? query.in('status',['completed','canceled','client_absent','provider_absent','no_show']) : query.eq('status',filter)
      const result=await query.order('scheduled_start',{ascending:false,nullsFirst:false}).order('id').range(page*25,page*25+24)
      if(result.error) throw result.error
      setRows(result.data as unknown as Row[]);setMore(result.data.length===25)
    } catch(cause) { setRows([]);setMore(false);setError(cause instanceof Error?cause.message:'Unable to load history. Try again.') }
    finally {setBusy(false)}
  },[page,filter])
  useEffect(()=>{void load()},[load])
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <Link href="/my-sessions" className="rj-button rj-button-secondary">Back to my sessions</Link>
    <h1 className="rj-heading-1">Session history</h1>
    <label className="block">Session outcome<select className="rj-input mt-2" value={filter} disabled={busy} onChange={e=>{setFilter(e.target.value);setPage(0)}}>{['all','completed','canceled','client_absent','provider_absent','no_show'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
    {error && <div role="alert">{error}<button className="rj-button rj-button-secondary" onClick={()=>void load()}>Try again</button></div>}
    {busy ? <p role="status">Loading history…</p> : <>
      {!rows.length&&!error&&<p>No sessions match this page.</p>}
      {rows.map(row=><Link key={row.id} href={`/session/${row.id}/complete`} className="rj-card block p-5">
        <h2 className="rj-heading-3">{row.clients?.preferred_name||row.clients?.first_name||'Session'}</h2>
        <p>{row.scheduled_start?new Date(row.scheduled_start).toLocaleString():'Unscheduled'} · {row.status.replaceAll('_',' ')}</p>
        <p>Note: {row.session_notes?.status || 'not created'}</p>
      </Link>)}
    </>}
    <nav aria-label="History pages" className="flex items-center gap-4"><button className="rj-button rj-button-secondary" disabled={busy||page===0} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page+1}</span><button className="rj-button rj-button-secondary" disabled={busy||!more} onClick={()=>setPage(value=>value+1)}>Next</button></nav>
  </main>
}
