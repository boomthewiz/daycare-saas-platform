"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { noteActions, noteFailure, type NoteAction, type SessionNote } from '@/lib/session-notes'

type Session = { id: string; provider_id: string | null; status: string; session_type: string; started_at: string | null; completed_at: string | null; scheduled_start: string | null; clients?: {first_name:string;last_name:string|null;preferred_name:string|null}|null }
type Identity = { userId: string; frontline: boolean; reviewer: boolean; admin: boolean }
type Remark = { id: string; author_name: string; body: string; created_at: string }
type History = { id: string; actor_name: string; action: string; occurred_at: string; snapshot: SessionNote }
type Pending = { kind: 'note' | 'remark'; args: Record<string, string | number | null> }
const labels: Record<NoteAction, string> = { save: 'Save draft', submit: 'Submit for review', return: 'Return for correction', approve: 'Approve note', lock: 'Lock note', revert_approval: 'Revert approval', unlock: 'Unlock note' }
const date = (value: string | null) => value ? new Date(value).toLocaleString() : '—'
const label = (value: string) => value.replaceAll('_', ' ')

export default function SessionNoteWorkspace({ sessionId, review = false }: { sessionId: string; review?: boolean }) {
  const [session, setSession] = useState<Session | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [note, setNote] = useState<SessionNote | null>(null)
  const [text, setText] = useState('')
  const [addendum, setAddendum] = useState('')
  const [feedback, setFeedback] = useState('')
  const [remark, setRemark] = useState('')
  const [remarks, setRemarks] = useState<Remark[]>([])
  const [history, setHistory] = useState<History[]>([])
  const [moreHistory, setMoreHistory] = useState(false)
  const [moreRemarks, setMoreRemarks] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [summary, setSummary] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoaded(false)
    try {
      const auth = await supabase.auth.getUser()
      if (auth.error || !auth.data.user) throw new Error('Sign in to view this record.')
      const userId = auth.data.user.id
      const results = await Promise.all([
        supabase.from('sessions').select('id,provider_id,status,session_type,started_at,completed_at,scheduled_start,clients(first_name,last_name,preferred_name)').eq('id', sessionId).single(),
        supabase.from('session_notes').select('*').eq('session_id', sessionId).maybeSingle(),
        supabase.from('users').select('role,status').eq('id', userId).single(),
        supabase.rpc('is_frontline_staff'), supabase.rpc('can_review_sessions'),
        supabase.from('session_note_history').select('id,actor_name,action,occurred_at,snapshot').eq('session_id', sessionId).order('occurred_at', { ascending: false }).order('id').range(0, 19),
        supabase.from('session_note_remarks').select('id,author_name,body,created_at').eq('session_id', sessionId).order('created_at', { ascending: false }).order('id').range(0, 19),
      ])
      for (const result of results) if (result.error) throw result.error
      const [s, n, u, frontline, reviewer, h, r] = results
      const account = u.data as { role: string; status: string }
      const current: Identity = { userId, frontline: frontline.data === true, reviewer: reviewer.data === true, admin: account.status === 'active' && ['owner', 'admin'].includes(account.role) }
      if (review && !current.reviewer && !current.admin) throw new Error('Review access is required.')
      const currentNote = n.data as SessionNote | null
      setSession(s.data as unknown as Session); setIdentity(current); setNote(currentNote)
      setText(currentNote?.final_note || currentNote?.generated_note || '')
      setAddendum(currentNote?.therapist_addendum || '')
      setFeedback('')
      setHistory((h.data || []) as History[]); setMoreHistory(h.data?.length === 20)
      setRemarks((r.data || []) as Remark[]); setMoreRemarks(r.data?.length === 20)
      setPending(null); setDirty(false); setLoaded(true)
    } catch (cause) { setError(noteFailure(cause)) }
    finally { setLoading(false) }
  }, [sessionId, review])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!dirty && !pending && !remark && !feedback) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending, remark, feedback])

  const execute = async (request: Pending) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null); setMessage(null)
    setPending(request)
    try {
      const result = await supabase.rpc(request.kind === 'note' ? 'mutate_session_note' : 'append_session_note_remark', request.args)
      if (result.error) throw result.error
      if (!result.data?.id) throw new Error('The server did not confirm the change. Retry to check its outcome.')
      if (request.kind === 'note') {
        const saved = result.data as SessionNote
        setNote(saved); setText(saved.final_note || saved.generated_note || ''); setAddendum(saved.therapist_addendum || '')
        setFeedback(''); setDirty(false)
      } else { setRemark('') }
      setPending(null)
      setMessage(request.kind === 'remark' ? 'Remark appended. The note and its timestamps are unchanged.' : 'Change saved.')
      // A refresh failure must never make a confirmed write look unsuccessful.
      const [h, r] = await Promise.all([
        supabase.from('session_note_history').select('id,actor_name,action,occurred_at,snapshot').eq('session_id', sessionId).order('occurred_at', { ascending: false }).order('id').range(0,19),
        supabase.from('session_note_remarks').select('id,author_name,body,created_at').eq('session_id', sessionId).order('created_at', { ascending: false }).order('id').range(0,19),
      ])
      if (h.error || r.error) setError('The change was saved, but history could not be refreshed. Reload to see the latest history.')
      else { setHistory(h.data as History[]); setMoreHistory(h.data.length===20); setRemarks(r.data as Remark[]); setMoreRemarks(r.data.length===20) }
    } catch (cause) { setError(noteFailure(cause)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const act = (action: NoteAction) => {
    if (pending || busy || !actions.includes(action)) return
    if (action === 'submit' && !text.trim()) { setError('Complete the note before submitting.'); return }
    if (action === 'return' && !feedback.trim()) { setError('Explain the correction needed before returning this note.'); return }
    void execute({ kind: 'note', args: { p_session_id: sessionId, p_action: action, p_version: note?.version || 0, p_operation_id: crypto.randomUUID(), p_final_note: action==='save'||action==='submit' ? text : null, p_addendum: action==='save'||action==='submit' ? addendum : null, p_feedback: feedback || null } })
  }
  const reload = () => {
    if ((dirty || pending || remark || feedback) && !window.confirm('Reload the saved record? Copy any unsaved text first; reloading replaces the editor contents.')) return
    void load()
  }
  const loadMore = async (kind: 'history' | 'remarks') => {
    setBusy(true)
    try {
      const offset = kind==='history' ? history.length : remarks.length
      const result = await supabase.from(kind==='history' ? 'session_note_history' : 'session_note_remarks')
        .select(kind==='history' ? 'id,actor_name,action,occurred_at,snapshot' : 'id,author_name,body,created_at')
        .eq('session_id',sessionId).order(kind==='history' ? 'occurred_at' : 'created_at',{ascending:false}).order('id').range(offset,offset+19)
      if(result.error) throw result.error
      if(kind==='history') { setHistory(previous=>[...previous,...result.data as unknown as History[]]); setMoreHistory(result.data.length===20) }
      else { setRemarks(previous=>[...previous,...result.data as unknown as Remark[]]); setMoreRemarks(result.data.length===20) }
    } catch(cause) { setError(noteFailure(cause)) } finally { setBusy(false) }
  }
  const readSummary = async () => {
    setBusy(true); setError(null)
    try {
      // PostgREST caps a response; paginate so a long session is not silently summarized from a partial record.
      const allRows = async <T,>(table: string, columns: string): Promise<T[]> => {
        const rows: T[] = []
        for (let offset=0; ; offset+=500) {
          const result = await supabase.from(table).select(columns).eq('session_id',sessionId).order('id').range(offset,offset+499)
          if (result.error) throw result.error
          rows.push(...result.data as unknown as T[])
          if (result.data.length<500) return rows
        }
      }
      const [t,r,b] = await Promise.all([
        allRows<{id:string;title:string;status:string}>('session_targets','id,title,status'),
        allRows<{session_target_id:string;result:string}>('target_responses','session_target_id,result'),
        allRows<{behavior_name:string;count:number}>('behavior_events','behavior_name,count'),
      ])
      setSummary([
        `Client: ${session?.clients?.preferred_name || session?.clients?.first_name || 'Client'}.`,
        `Service: ${label(session?.session_type || '')}.`,
        `Started: ${date(session?.started_at || null)}. Completed: ${date(session?.completed_at || null)}.`,
        ...t.map(target=>`${target.title}: ${r.filter(response=>response.session_target_id===target.id).map(response=>label(response.result)).join(', ') || 'No recorded responses'}.`),
        ...b.map(event=>`${event.behavior_name}: ${event.count}.`),
      ].join('\n'))
    } catch(cause) { setError(noteFailure(cause)) } finally { setBusy(false) }
  }
  const actions = loaded && identity && session ? noteActions(note, {...identity, providerId:session.provider_id,sessionStatus:session.status}) : []
  const editable = actions.includes('save')
  const disabled = busy || !!pending || !loaded
  if (loading) return <p role="status" className="p-6">Loading session documentation…</p>
  return <div className="mx-auto min-w-0 max-w-4xl space-y-6 break-words p-1 sm:p-6">
    <Link onClick={event=>{if((dirty||pending||remark||feedback)&&!window.confirm('Leave with unsaved work? Keep this page open or copy your text first.')) event.preventDefault()}} className="rj-button rj-button-secondary" href={review ? '/reviews' : `/session/${sessionId}`}>Back to {review ? 'reviews' : 'session'}</Link>
    <header className="rj-card p-6">
      <h1 className="rj-heading-1">Session documentation</h1>
      <p className="mt-2 font-bold">{session?.clients ? [session.clients.preferred_name||session.clients.first_name,session.clients.last_name].filter(Boolean).join(' ') : 'Session record'} · {date(session?.scheduled_start || null)}</p>
      <p className="mt-2 capitalize">Session: {label(session?.status || 'unavailable')} · Note: {label(note?.status || 'not created')}</p>
      {note?.status==='locked' && <p>Locked from {note.locked_from_status === 'approved' ? 'approved' : 'submitted (unapproved)'}. An owner or admin must unlock it before any status change.</p>}
      {note && <p className="rj-caption mt-2">Created {date(note.created_at)} · Updated {date(note.updated_at)} · Version {note.version}<br/>Submitted {date(note.submitted_at)} · Reviewed {date(note.reviewed_at)} · Locked {date(note.locked_at)}</p>}
      <button className="rj-button rj-button-secondary mt-4" disabled={busy} onClick={reload}>Reload saved record</button>
    </header>
    {error && <div role="alert" className="rj-card p-4 text-[var(--rj-danger)]">{error}</div>}
    {message && <p role="status" className="rj-card p-4">{message}</p>}
    {pending && <div className="rj-card p-4"><p>The last request needs confirmation. Retry checks the same request without duplicating it. You can select and copy your text below.</p><button disabled={busy} onClick={()=>void execute(pending)} className="rj-button rj-button-primary mt-3">Retry last request</button></div>}
    {loaded && <>
      {note?.review_notes && <section className="rj-card p-6"><h2 className="rj-heading-2">Reviewer feedback</h2><p className="mt-3 whitespace-pre-wrap">{note.review_notes}</p></section>}
      <section className="rj-card space-y-4 p-6">
        <h2 className="rj-heading-2">Session note</h2>
        {editable && <p>Save notes while the session is active or paused. Submit after completion. Unsaved text stays in this tab; it is not saved automatically.</p>}
        <label className="block" htmlFor="note-observations">Session observations</label><textarea id="note-observations" className="rj-input mt-2 w-full" rows={5} value={addendum} maxLength={20000} readOnly={!editable||disabled} onChange={e=>{setAddendum(e.target.value);setDirty(true)}} />
        <label className="block" htmlFor="note-final">Final note</label><textarea id="note-final" className="rj-input mt-2 w-full" rows={14} value={text} maxLength={100000} readOnly={!editable||disabled} onChange={e=>{setText(e.target.value);setDirty(true)}} />
        {editable && <p role="status">{dirty ? 'Unsaved changes' : 'Showing saved text'}</p>}
        {!editable && <p>This note is read-only. Status changes and remarks are recorded separately.</p>}
        <div className="flex flex-wrap gap-3">{actions.filter(a=>a==='save'||a==='submit').map(action=><button key={action} disabled={disabled} className="rj-button rj-button-primary" onClick={()=>act(action)}>{labels[action]}</button>)}</div>
        {editable && <details><summary>Recorded session data</summary><button disabled={disabled} className="rj-button rj-button-secondary my-3" onClick={()=>void readSummary()}>Load recorded data</button><pre className="whitespace-pre-wrap font-sans">{summary}</pre><p className="rj-caption">Use these observations to write the note. Loading them does not overwrite your text.</p>{summary && <button disabled={disabled} className="rj-button rj-button-secondary mt-3" onClick={()=>{if(!text || window.confirm('Replace the current final-note draft with this recorded summary?')){setText([summary,addendum].filter(Boolean).join('\n\n'));setDirty(true)}}}>Use as note draft</button>}</details>}
      </section>
      {actions.some(a=>!['save','submit'].includes(a)) && <section className="rj-card space-y-4 p-6">
        <h2 className="rj-heading-2">Review controls</h2>
        {actions.includes('return') && <><label className="block" htmlFor="note-feedback">Review feedback (required to return)</label><textarea id="note-feedback" className="rj-input mt-2 w-full" rows={4} value={feedback} maxLength={20000} readOnly={disabled} onChange={e=>setFeedback(e.target.value)} /></>}
        <p>Reverting approval returns the note to submitted. Unlocking restores its status before locking; it does not make the note editable.</p>
        <div className="flex flex-wrap gap-3">{actions.filter(a=>!['save','submit'].includes(a)).map(action=><button key={action} disabled={disabled} className="rj-button rj-button-secondary" onClick={()=>act(action)}>{labels[action]}</button>)}</div>
      </section>}
      <section className="rj-card space-y-4 p-6"><h2 className="rj-heading-2">Remarks</h2>
        <p>Separate additions from owners and admins. Remarks never alter the original note or its timestamps.</p>
        {identity?.admin && note && <><label className="block" htmlFor="note-remark">Add a remark</label><textarea id="note-remark" className="rj-input mt-2 w-full" rows={3} maxLength={20000} readOnly={disabled} value={remark} onChange={e=>setRemark(e.target.value)} /><button disabled={disabled||!remark.trim()} className="rj-button rj-button-primary" onClick={()=>void execute({kind:'remark',args:{p_session_id:sessionId,p_body:remark,p_operation_id:crypto.randomUUID()}})}>Append remark</button></>}
        {!remarks.length && <p>No remarks yet.</p>}
        {remarks.map(item=><article key={item.id} className="border-t pt-3"><p className="font-bold">{item.author_name} · {date(item.created_at)}</p><p className="whitespace-pre-wrap">{item.body}</p></article>)}
        {moreRemarks && <button disabled={busy} onClick={()=>void loadMore('remarks')}>Load older remarks</button>}
      </section>
      <section className="rj-card space-y-4 p-6"><h2 className="rj-heading-2">Note history</h2>
        {!history.length && <p>History begins when the first draft is saved.</p>}
        {history.map(item=><details key={item.id} className="border-t pt-3"><summary className="cursor-pointer capitalize">{label(item.action)} · {item.actor_name} · {date(item.occurred_at)}</summary><p className="my-2">Version {item.snapshot.version} · {item.snapshot.status}</p>{item.action==='baseline' && <p>Existing record at the start of history tracking. Earlier changes are not reconstructed.</p>}<p className="whitespace-pre-wrap">{item.snapshot.final_note || item.snapshot.generated_note || 'No final text'}</p><p className="mt-3 whitespace-pre-wrap">Observations: {item.snapshot.therapist_addendum || '—'}</p><p className="mt-3 whitespace-pre-wrap">Review feedback: {item.snapshot.review_notes || '—'}</p></details>)}
        {moreHistory && <button disabled={busy} onClick={()=>void loadMore('history')}>Load older history</button>}
      </section>
    </>}
  </div>
}
