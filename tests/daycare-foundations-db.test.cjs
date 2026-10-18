/* eslint-disable @typescript-eslint/no-require-imports -- Offline PostgreSQL integration tests. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const options={skip:!process.env.REJOYCE_BASELINE_SQL||!process.env.REJOYCE_PGLITE_MODULE}
test('attendance source isolation, branch scopes, history, versions, retries and correction rules',options,async()=>{
 const db=await createFoundationsDatabase()
 const val=async(sql,args=[]) => (await db.query(sql,args)).rows[0].value
 const command=(action,{child=null,branch=null,visit=null,version=null,start=null,end=null,reason=null,operation=randomUUID()}={})=>val('SELECT public.attendance_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[action,child,branch,visit,version,start,end,reason,operation])
 try{
  const op=randomUUID(),input={child:ids.client,branch:ids.north,operation:op}
  const visit=await command('check_in',input)
  assert.deepEqual(await command('check_in',input),visit,'retry returns same committed result')
  await assert.rejects(command('check_in',{child:ids.client,branch:ids.south}),{code:'40001'})
  await assert.rejects(command('check_in',{child:ids.client,branch:ids.south,operation:op}),{code:'40001'})
  await assert.rejects(command('check_in',{child:ids.foreignClient,branch:ids.north}),{code:'42501'})
  await assert.rejects(command('check_in',{child:ids.sourceClient,branch:ids.foreignBranch}),{code:'22023'})
  await assert.rejects(val('SELECT * FROM rejoyce_security.attendance_visits'),{code:'42501'})
  await db.exec(`RESET ROLE;INSERT INTO public.user_permissions(user_id,organization_id,can_view_attendance,can_record_attendance,can_correct_attendance) VALUES('${ids.staff}','${ids.org}',true,true,true); SET ROLE authenticated;`)
  await val('SELECT public.set_attendance_scope($1,$2,$3) value',[ids.staff,[ids.north],[]])
  await assert.rejects(val('SELECT public.set_attendance_scope($1,$2,$3) value',[ids.staff,[ids.foreignBranch],[ids.north]]),{code:'42501'})
  await actor(db,ids.staff,ids.staffDevice)
  await assert.rejects(command('check_in',{child:ids.client,branch:ids.south}),{code:'42501'})
  await assert.rejects(command('correct',{visit:visit.id,version:1,branch:ids.south,start:visit.check_in,reason:'Wrong branch'}),{code:'42501'})
  await assert.rejects(val('SELECT public.set_attendance_scope($1,$2,$3) value',[ids.staff,[ids.south],[ids.north]]),{code:'42501'})
  await assert.rejects(command('check_out',{visit:visit.id,version:99}),{code:'40001'})
  const closed=await command('check_out',{visit:visit.id,version:1})
  assert.equal(closed.version,2)
  await assert.rejects(command('correct',{visit:visit.id,version:2,branch:ids.north,start:'2099-01-01T00:00:00Z',reason:'Future invalid'}),{code:'22023'})
  const corrected=await command('correct',{visit:visit.id,version:2,branch:ids.north,start:visit.check_in,end:closed.check_out,reason:'Confirmed timing'})
  const history=await val('SELECT public.attendance_history($1) value',[visit.id])
  assert.deepEqual(history.map(event=>event.action),['check_in','check_out','correct'])
  assert.equal(history[0].actor_id,ids.owner);assert.equal(history[2].actor_id,ids.staff)
  assert.equal((await command('void',{visit:visit.id,version:corrected.version,reason:'Duplicate synthetic visit'})).voided,true)
  await assert.rejects(command('check_out',{visit:visit.id,version:4}),{code:'40001'})
  await db.exec(`RESET ROLE;UPDATE public.user_permissions SET can_view_attendance=false WHERE user_id='${ids.staff}'; SET ROLE authenticated;`)
  await assert.rejects(val('SELECT public.attendance_history($1) value',[visit.id]),{code:'42501'})
  await actor(db)
  await db.exec('RESET ROLE')
  await assert.rejects(db.query('DELETE FROM rejoyce_security.attendance_events WHERE visit_id=$1',[visit.id]),/append-only/)
  await db.exec(`UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}'`);await actor(db)
  await assert.rejects(command('check_in',input),{code:'42501'})
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(val('SELECT public.attendance_context() value'),{code:'42501'})
 }finally{await db.close()}
})
test('attendance read uses event branch, explicit classroom gaps, minimal rows and close-only subscription continuity',options,async()=>{
 const db=await createFoundationsDatabase();const val=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value
 try{
  const visit=await val("SELECT public.attendance_mutate('check_in',$1,$2,p_operation:=$3) value",[ids.client,ids.north,randomUUID()])
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.attendance_visits SET original_check_in=now()-interval '2 days',check_in=now()-interval '2 days' WHERE id='${visit.id}';
  DELETE FROM public.client_locations WHERE client_id='${ids.client}';UPDATE public.clients SET status='inactive' WHERE id='${ids.client}';UPDATE public.organization_locations SET active=false WHERE id='${ids.north}';
  INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '30 days',now()-interval '1 day','{}');SET ROLE authenticated;`)
  const read=await val("SELECT public.attendance_read($1,current_date,current_date,true) value",[ids.north])
  assert.equal(read.rows.length,1,'open visits stay visible regardless of current membership, activity or date')
  assert.equal(read.rows[0].classroom_id,null);assert.equal(read.rows[0].branch_name,'North');assert.equal(read.rows[0].reason,undefined)
  await assert.rejects(val("SELECT public.attendance_mutate('check_in',$1,$2,p_operation:=$3) value",[ids.sourceClient,ids.south,randomUUID()]),{code:'42501'})
  const operation=randomUUID();const closeArgs=[visit.id,visit.version,operation]
  const closed=await val("SELECT public.attendance_mutate('check_out',p_visit:=$1,p_version:=$2,p_operation:=$3) value",closeArgs)
  assert.ok(closed.check_out)
  assert.deepEqual(await val("SELECT public.attendance_mutate('check_out',p_visit:=$1,p_version:=$2,p_operation:=$3) value",closeArgs),closed,'eligible close retry survives read-only state')
  await assert.rejects(val("SELECT public.attendance_mutate('void',p_visit:=$1,p_version:=$2,p_reason:='Cannot change',p_operation:=$3) value",[visit.id,2,randomUUID()]),{code:'42501'})
 }finally{await db.close()}
})
test('session tags normalize/deduplicate without clinical authority and atomically save current-user recent choices',options,async()=>{
 const db=await createFoundationsDatabase();const val=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value
 try{
  const tag=await val("SELECT public.save_session_choice('tag',' Parent   observed ','aba') value")
  assert.equal(await val("SELECT public.save_session_choice('tag','parent observed','aba') value"),tag)
  await assert.rejects(val("SELECT public.save_session_choice('tag','Parent observed','shared') value"),{code:'40001'})
  const location=await val("SELECT public.save_session_choice('location','Family room','shared') value")
  const type=await val("SELECT public.save_session_type_choice('Parent practice',45) value")
  assert.deepEqual(await val("SELECT public.save_session_type_choice(' parent   practice ',45) value"),type)
  await assert.rejects(val("SELECT public.save_session_type_choice('Parent practice',60) value"),{code:'40001'})
  await assert.rejects(val("SELECT public.save_session_choice('tag',E'Bad\\nlabel','shared') value"),{code:'22023'})
  const operation=randomUUID(),start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString()
  const args=[ids.client,ids.staff,start,end,'direct_therapy','Family room',[tag],operation]
  const query='SELECT public.create_context_session($1,$2,$3,$4,$5,$6,$7,$8) value'
  const session=await val(query,args);assert.deepEqual(await val(query,args),session)
  const context=await val('SELECT public.session_context($1) value',[session.session_id])
  assert.equal(context.tags[0].label,'Parent observed');assert.equal(context.tags[0].domain,'aba')
  assert.equal(context.recent.length,1);assert.equal(context.recent[0].child_id,ids.client)
  await assert.rejects(val(query,[...args.slice(0,6),[location],randomUUID()]),{code:'42501'},'locations cannot masquerade as tags')
  await assert.rejects(val(query,[...args.slice(0,6),[randomUUID()],randomUUID()]),{code:'42501'})
  await actor(db,ids.staff,ids.staffDevice);await assert.rejects(val('SELECT public.session_context() value'),{code:'42501'})
  await db.exec(`RESET ROLE;INSERT INTO public.user_permissions(user_id,organization_id,can_manage_sessions) VALUES('${ids.staff}','${ids.org}',true);SET ROLE authenticated;`)
  assert.equal((await val('SELECT public.session_context() value')).recent.length,0,'another user never receives recent child/preset history')
  assert.equal(await val("SELECT public.has_org_permission('review_sessions') value"),false,'ABA tag grants no clinical review authority')
 }finally{await db.close()}
})
test('attendance corrections reject overlap/older originals and preserve event-time DST range semantics',options,async()=>{
 const db=await createFoundationsDatabase(),val=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value
 try{
  await db.exec(`RESET ROLE;INSERT INTO rejoyce_security.attendance_visits(organization_id,child_id,branch_id,branch_name,timezone,original_check_in,check_in,check_out) VALUES
   ('${ids.org}','${ids.client}','${ids.north}','North','America/Chicago','2026-03-08T05:00:00Z','2026-03-08T05:00:00Z','2026-03-08T06:30:00Z'),
   ('${ids.org}','${ids.client}','${ids.north}','North','America/Chicago','2026-03-09T05:00:00Z','2026-03-09T05:00:00Z','2026-03-09T06:00:00Z'),
   ('${ids.org}','${ids.client}','${ids.north}','North','America/Chicago','2026-11-02T05:00:00Z','2026-11-02T05:00:00Z','2026-11-02T06:00:00Z'),
   ('${ids.org}','${ids.client}','${ids.north}','North','America/Chicago','2026-11-02T06:00:00Z','2026-11-02T06:00:00Z','2026-11-02T07:00:00Z');SET ROLE authenticated;`)
  const spring=await val("SELECT public.attendance_read($1,'2026-03-08','2026-03-08',false) value",[ids.north])
  assert.equal(spring.rows.length,1);assert.equal(spring.rows[0].carry_in,true)
  const fall=await val("SELECT public.attendance_read($1,'2026-11-01','2026-11-01',false) value",[ids.north]);assert.equal(fall.rows.length,1)
  const visit=spring.rows[0]
  await assert.rejects(val("SELECT public.attendance_mutate('correct',p_branch:=$1,p_visit:=$2,p_version:=1,p_in:=statement_timestamp()-interval '1 hour',p_reason:='Cannot reset window',p_operation:=$3) value",[ids.north,visit.id,randomUUID()]),{code:'22023'})
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.attendance_visits SET original_check_in=statement_timestamp(),check_in=statement_timestamp()-interval '2 hours',check_out=statement_timestamp()-interval '1 hour' WHERE id='${visit.id}';
   INSERT INTO rejoyce_security.attendance_visits(organization_id,child_id,branch_id,branch_name,timezone,original_check_in,check_in,check_out) VALUES('${ids.org}','${ids.client}','${ids.north}','North','America/Chicago',statement_timestamp(),statement_timestamp()-interval '45 minutes',statement_timestamp()-interval '15 minutes');SET ROLE authenticated;`)
  await assert.rejects(val("SELECT public.attendance_mutate('correct',p_branch:=$1,p_visit:=$2,p_version:=1,p_in:=statement_timestamp()-interval '2 hours',p_reason:='Overlap invalid',p_operation:=$3) value",[ids.north,visit.id,randomUUID()]),{code:'22023'})
 }finally{await db.close()}
})
