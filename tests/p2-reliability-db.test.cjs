/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic PostgreSQL coverage. */
require('./setup.cjs')
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const value=db=>async(sql,args=[])=>(await db.query(sql,args)).rows[0].value
test('saved choices search by kind beyond 500 and resolve selected IDs independently; lifecycle preserves snapshots',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 try{
  await db.exec(`RESET ROLE;INSERT INTO rejoyce_security.session_choices(organization_id,kind,label,created_by) SELECT '${ids.org}','tag','AAA '||lpad(n::text,4,'0'),'${ids.owner}' FROM generate_series(1,530) n;SET ROLE authenticated;`)
  const location=await val("SELECT public.save_session_choice('location','ZZZ room','shared') value")
  assert.equal((await val('SELECT public.session_context() value')).choices.some(row=>row.id===location),false,'reproduce legacy combined limit')
  const found=await val("SELECT public.search_session_choices('location','ZZZ',0,false) value")
  assert.equal(found.rows[0].id,location)
  assert.equal((await val('SELECT public.session_context_v2(NULL,$1,NULL) value',[[location]])).choices[0].id,location)
  const page=await val("SELECT public.search_session_choices('tag','AAA',0,false) value"),next=await val("SELECT public.search_session_choices('tag','AAA',1,false) value")
  assert.equal(page.rows.length,20);assert.equal(page.hasMore,true);assert.equal(new Set([...page.rows,...next.rows].map(row=>row.id)).size,40)
  const tag=page.rows[0]
  const session=await val("SELECT public.create_scheduled_context_session($1,$2,now(),now()+interval '1 hour','direct_therapy',NULL,$3,$4,'activity') value",[ids.client,ids.staff,[tag.id],randomUUID()])
  await val("SELECT public.update_session_choice($1,1,'rename','Renamed choice') value",[tag.id])
  await assert.rejects(val("SELECT public.update_session_choice($1,1,'archive') value",[tag.id]),{code:'40001'})
  await val("SELECT public.update_session_choice($1,2,'archive') value",[tag.id])
  assert.equal((await val('SELECT public.session_context($1) value',[session.session_id])).tags[0].label,tag.label)
  await assert.rejects(val("SELECT public.save_session_choice('tag','renamed choice','shared') value"),{code:'40001'})
  assert.equal((await val("SELECT public.search_session_choices('tag','Renamed',0,false) value")).rows.length,0)
  assert.equal((await val('SELECT public.session_context_v2(NULL,$1,NULL) value',[[tag.id]])).choices[0].active,false)
  await val("SELECT public.update_session_choice($1,3,'restore') value",[tag.id])
  assert.equal(await val("SELECT public.save_session_choice('tag','Renamed choice','shared') value"),tag.id)
  await assert.rejects(val("SELECT public.update_session_choice($1,4,'rename',$2) value",[tag.id,page.rows[1].label]),{code:'40001'})
  await actor(db,ids.staff,ids.staffDevice);await assert.rejects(val("SELECT public.search_session_choices('tag','',0,true) value"),{code:'42501'})
 }finally{await db.close()}
})
test('opaque save recovery resolves committed receipts and cancellation fences delayed old/new requests',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 const create=(op)=>val("SELECT public.create_scheduled_context_session($1,$2,now(),now()+interval '1 hour','direct_therapy',NULL,'{}',$3,'activity') value",[ids.client,ids.staff,op])
 try{
  const committed=randomUUID(),session=await create(committed)
  assert.deepEqual(await val('SELECT public.recover_session_creation($1,false) value',[committed]),{state:'committed',session_id:session.session_id})
  assert.equal((await val('SELECT public.recover_session_creation($1,true) value',[committed])).state,'committed','cancel after commit does not hide committed session')
  const pending=randomUUID();assert.equal((await val('SELECT public.recover_session_creation($1,false) value',[pending])).state,'unconfirmed')
  assert.equal((await val('SELECT public.recover_session_creation($1,true) value',[pending])).state,'canceled')
  await assert.rejects(create(pending),{code:'40001'})
  await assert.rejects(val("SELECT public.create_context_session($1,$2,now(),now()+interval '1 hour','direct_therapy',NULL,'{}',$3) value",[ids.client,ids.staff,pending]),{code:'40001'})
  await db.exec(`RESET ROLE;INSERT INTO public.user_permissions(organization_id,user_id,can_manage_sessions) VALUES('${ids.org}','${ids.staff}',true);SET ROLE authenticated;`)
  await actor(db,ids.staff,ids.staffDevice)
  await assert.rejects(val('SELECT public.recover_session_creation($1,false) value',[committed]),{code:'42501'})
  await assert.rejects(val('SELECT public.recover_session_creation($1,false) value',[pending]),{code:'42501'})
 }finally{await db.close()}
})
test('local correction candidates reject DST gaps and require an explicit valid occurrence for folds',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 try{
  const visit=await val("SELECT public.attendance_mutate('check_in',$1,$2,p_operation:=$3) value",[ids.client,ids.north,randomUUID()])
  let options=await val("SELECT public.attendance_local_options($1,'2026-03-08T02:30:00'::timestamp) value",[visit.id])
  assert.deepEqual(options.instants,[])
  options=await val("SELECT public.attendance_local_options($1,'2026-11-01T01:30:00'::timestamp) value",[visit.id])
  assert.equal(options.instants.length,2);assert.equal(new Date(options.instants[1])-new Date(options.instants[0]),3600000)
  await assert.rejects(val("SELECT public.correct_attendance_local($1,1,$2,'2026-11-01T01:30:00',NULL,NULL,NULL,'Invalid occurrence',$3) value",[visit.id,ids.north,randomUUID()]),{code:'22023'})
  await assert.rejects(val("SELECT public.correct_attendance_local($1,1,$2,'2026-03-08T02:30:00',NULL,'2026-03-08T08:30:00Z',NULL,'Nonexistent',$3) value",[visit.id,ids.north,randomUUID()]),{code:'22023'})
  const {organizationLocalTime}=require('./helpers/load-ts.cjs')('lib/organization-local-time.ts')
  const local=organizationLocalTime(visit.check_in,'America/Chicago')
  options=await val('SELECT public.attendance_local_options($1,$2) value',[visit.id,local])
  const corrected=await val('SELECT public.correct_attendance_local($1,1,$2,$3,NULL,$4,NULL,$5,$6) value',[visit.id,ids.north,local,options.instants[0],'Current local correction',randomUUID()])
  assert.equal(corrected.version,2)
  await actor(db,ids.staff,ids.staffDevice);await assert.rejects(val('SELECT public.attendance_local_options($1,$2) value',[visit.id,local]),{code:'42501'})
 }finally{await db.close()}
})
test('tasks use organization-local due dates, explicit owners and current client links without legacy joins',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 try{
  await db.exec(`RESET ROLE;INSERT INTO public.tasks(organization_id,teacher_id,client_id,title,due_at) VALUES
   ('${ids.org}','${ids.staff}','${ids.sourceClient}','Late local task','2026-10-20T02:00:00Z'),
   ('${ids.org}','${ids.owner}',NULL,'Other owner task','2026-10-20T02:00:00Z');
   INSERT INTO public.tasks(organization_id,teacher_id,title,generated_date) VALUES('${ids.org}','${ids.staff}','Date-only legacy','2026-10-19');SET ROLE authenticated;`)
  let result=await val("SELECT public.task_workspace('2026-10-19',0) value")
  assert.equal(result.rows.length,3);assert.equal(result.timezone,'America/Chicago')
  assert.equal((await val("SELECT public.task_workspace('2026-10-20',0) value")).rows.length,0)
  await actor(db,ids.staff,ids.staffDevice)
  result=await val("SELECT public.task_workspace('2026-10-19',0) value");assert.equal(result.rows.length,2);assert.equal(result.rows.find(row=>row.title==='Late local task').client_name,null,'task assignment does not confer clinical client access')
  const task=result.rows[0]
  await val('SELECT public.set_task_completed($1,false,true) value',[task.id])
  await assert.rejects(val('SELECT public.set_task_completed($1,false,true) value',[task.id]),{code:'40001'})
  await assert.rejects(db.query("UPDATE public.tasks SET title='Unauthorized' WHERE id=$1",[task.id]),{code:'42501'})
  const count=await val('SELECT count(*)::integer value FROM public.tasks');assert.equal(count,2,'direct RLS matches RPC ownership')
  await actor(db);await db.exec('RESET ROLE;DELETE FROM rejoyce_security.reporting_settings;SET ROLE authenticated;')
  await assert.rejects(val('SELECT public.task_workspace(NULL,0) value'),{code:'22023'})
 }finally{await db.close()}
})
