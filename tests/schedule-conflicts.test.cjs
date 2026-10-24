/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic PostgreSQL. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const payload=(start='2026-11-01T06:00:00Z',end='2026-11-01T07:00:00Z')=>({p_child:ids.client,p_provider:ids.staff,p_start:start,p_end:end,p_type:'direct_therapy',p_location:'Play room',p_tags:[],p_operation:randomUUID(),p_intent:'activity'})
const ack={reason:'Reviewed planned pull-out and staff responsibilities.',staff:true,children:true,uncertainty:true}
const scan=async(db,action,p)=>(await db.query('SELECT public.schedule_conflicts($1,$2) v',[action,p])).rows[0].v
const save=async(db,action,p,review=null,a={})=>(await db.query('SELECT public.save_reviewed_schedule($1,$2,$3,$4) v',[action,p,review,a])).rows[0].v
async function reviewed(db,action,p,a=ack){const r=await scan(db,action,p);return save(db,action,p,r.reviewId,a)}
test('half-open cross-workflow reader counts events once and keeps restricted details private',async()=>{
 const db=await createFoundationsDatabase();try{
  const p=payload(),first=await reviewed(db,'create_session',p)
  assert.ok(first.session_id)
  const adjacent=await scan(db,'create_session',payload('2026-11-01T07:00:00Z','2026-11-01T08:00:00Z'));assert.equal(adjacent.totalEvents,0)
  const conflict=await scan(db,'create_session',{...payload('2026-11-01T06:30:00Z','2026-11-01T07:30:00Z'),p_intent:'clinical'})
  assert.equal(conflict.totalEvents,1);assert.equal(conflict.staffEvents,1);assert.equal(conflict.childEvents,1)
  assert.deepEqual(Object.keys(conflict).sort(),['childEvents','expiresAt','reviewId','staffEvents','totalEvents','uncertainEvents'].sort())
  assert.ok(!JSON.stringify(conflict).includes(first.session_id));assert.ok(!JSON.stringify(conflict).includes('Play room'))
 }finally{await db.close()}
})
test('stale reviews recheck before saving; review is bound to actor, payload and snapshot',async()=>{
 const db=await createFoundationsDatabase();try{
  const p=payload(),r=await scan(db,'create_session',p)
  const other=await reviewed(db,'create_session',payload());assert.ok(other.session_id)
  const stale=await save(db,'create_session',p,r.reviewId,ack);assert.equal(stale.review_required.totalEvents,1)
  await assert.rejects(save(db,'create_session',p,stale.review_required.reviewId,{reason:'too short'}),/Review each/)
  const changed=await save(db,'create_session',{...p,p_location:'Different room'},stale.review_required.reviewId,ack);assert.ok(changed.review_required)
  const saved=await save(db,'create_session',p,stale.review_required.reviewId,ack);assert.ok(saved.session_id)
  assert.deepEqual(await save(db,'create_session',p,null,{}),saved,'receipt retry needs no new acknowledgement')
  await db.exec('RESET ROLE')
  const audit=(await db.query('SELECT a.*,r.snapshot FROM rejoyce_security.schedule_conflict_acknowledgements a JOIN rejoyce_security.schedule_conflict_reviews r ON r.id=a.review_id')).rows
  assert.equal(audit.length,1);assert.equal(audit[0].actor_id,ids.owner);assert.equal(audit[0].record_id,saved.session_id);assert.equal(audit[0].snapshot.length,1)
 }finally{await db.close()}
})
test('group snapshots drive overlap detection after class edits; rescheduling excludes itself',async()=>{
 const db=await createFoundationsDatabase();try{
  const c=(await db.query('SELECT public.save_activity_class(NULL,NULL,$1,$2,$3,$4,true) v',['Snapshot class',ids.north,[ids.client],[ids.staff]])).rows[0].v
  const p={p_class:c.id,p_version:c.version,p_title:'Group play',p_children:[ids.client],p_staff:[ids.staff],p_start:'2026-11-01T06:00:00Z',p_end:'2026-11-01T07:00:00Z',p_type:'direct_therapy',p_location:null,p_operation:randomUUID()}
  const g=await reviewed(db,'create_group',p);assert.ok(g.group_activity)
  await db.query('SELECT public.save_activity_class($1,1,$2,$3,$4,$5,false)',[c.id,'Archived class',ids.north,[ids.client],[ids.staff]])
  assert.equal((await scan(db,'create_session',payload())).totalEvents,1)
  const edit={p_activity:g.session_id,p_version:1,p_start:'2026-11-01T06:30:00Z',p_end:'2026-11-01T07:30:00Z',p_location:'Garden',p_status:'confirmed'}
  assert.equal((await scan(db,'update_group',edit)).totalEvents,0)
  assert.equal((await reviewed(db,'update_group',edit)).version,2)
  const unchanged=(await db.query('SELECT public.activity_schedule($1) v',[g.session_id])).rows[0].v
  assert.equal(unchanged.children.length,1);assert.equal(unchanged.class_name,'Snapshot class')
 }finally{await db.close()}
})
test('cancel/absent/no-show do not occupy; unknown ends are uncertain across DST/midnight',async()=>{
 const db=await createFoundationsDatabase();try{
  await db.exec(`RESET ROLE; ALTER TABLE public.sessions DISABLE TRIGGER USER; UPDATE public.sessions SET scheduled_start='2026-11-01T05:30Z',scheduled_end=NULL WHERE id='${ids.session}'; ALTER TABLE public.sessions ENABLE TRIGGER USER;`);await actor(db)
  const r=await scan(db,'create_session',payload('2026-11-01T06:00Z','2026-11-01T07:00Z'));assert.equal(r.uncertainEvents,1)
  for(const status of ['canceled','client_absent','provider_absent','no_show']){
   await db.exec(`RESET ROLE; ALTER TABLE public.sessions DISABLE TRIGGER USER; UPDATE public.sessions SET status='${status}' WHERE id='${ids.session}'; ALTER TABLE public.sessions ENABLE TRIGGER USER;`);await actor(db)
   assert.equal((await scan(db,'create_session',payload())).totalEvents,0,status)
  }
  const overnight=await reviewed(db,'create_session',payload('2026-11-02T05:30Z','2026-11-02T06:30Z'))
  assert.ok(overnight.session_id)
  assert.equal((await scan(db,'create_session',payload('2026-11-02T06:00Z','2026-11-02T07:00Z'))).totalEvents,1)
 }finally{await db.close()}
})
test('individual edits keep stale-version and clinical-intent safeguards; cancellations and receipts survive',async()=>{
 const db=await createFoundationsDatabase();try{
  const p=payload(),saved=await reviewed(db,'create_session',p)
  const current=(await db.query('SELECT public.activity_schedule($1) v',[saved.session_id])).rows[0].v
  const edit={p_session:saved.session_id,p_version:current.updated_at,p_changes:{scheduled_start:'2026-11-01T06:30Z',scheduled_end:'2026-11-01T07:30Z',location:'Updated',status:'confirmed'}}
  assert.equal((await scan(db,'update_session',edit)).totalEvents,0)
  assert.ok((await reviewed(db,'update_session',edit)).id)
  await assert.rejects(reviewed(db,'update_session',edit),/changed/)
  await assert.rejects(scan(db,'update_session',{...edit,p_changes:{workflow_intent:'clinical'}}),/Unsupported/)
  const cancel=payload();await db.query('SELECT public.recover_session_creation($1,true)',[cancel.p_operation]);await assert.rejects(reviewed(db,'create_session',cancel),/canceled/)
 }finally{await db.close()}
})
test('tenant, grant, lock and subscription denials; private review/audit tables and invoker wrappers',async()=>{
 const db=await createFoundationsDatabase();try{
  await assert.rejects(scan(db,'create_session',{...payload(),p_child:ids.foreignClient}),/unavailable/)
  await actor(db,ids.staff,ids.staffDevice);await assert.rejects(scan(db,'create_session',payload()),/management required/)
  await db.exec(`RESET ROLE; UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}'`);await actor(db)
  await assert.rejects(scan(db,'create_session',payload()),/unlock|sign-in/)
  await db.exec(`RESET ROLE; UPDATE public.device_sessions SET revoked=false WHERE session_id='${ids.device}'; INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '30 days',now()-interval '1 day','{}')`);await actor(db)
  await assert.rejects(save(db,'create_session',payload()),/editing access/)
  await assert.rejects(db.query('SELECT * FROM rejoyce_security.schedule_conflict_reviews'),/permission denied/)
  await db.exec('RESET ROLE')
  const unsafe=(await db.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('schedule_conflicts','save_reviewed_schedule') AND (p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE'))")).rows[0].n;assert.equal(unsafe,0)
  await db.exec('SET ROLE anon');await assert.rejects(db.query("SELECT public.schedule_conflicts('create_session','{}')"),/permission denied/)
 }finally{await db.close()}
})

test('clinical rescheduling rechecks group participants; expired and other-actor reviews cannot authorize a save',async()=>{
 const db=await createFoundationsDatabase();try{
  const c=(await db.query('SELECT public.save_activity_class(NULL,NULL,$1,$2,$3,$4,true) v',['Clinical overlap',ids.north,[ids.client],[ids.staff]])).rows[0].v
  await reviewed(db,'create_group',{p_class:c.id,p_version:1,p_title:'Class activity',p_children:[ids.client],p_staff:[ids.staff],p_start:'2026-11-01T06:00Z',p_end:'2026-11-01T07:00Z',p_type:'direct_therapy',p_location:null,p_operation:randomUUID()})
  const version=(await db.query('SELECT updated_at::text v FROM public.sessions WHERE id=$1',[ids.session])).rows[0].v
  const p={p_session:ids.session,p_version:version,p_changes:{scheduled_start:'2026-11-01T06:30Z',scheduled_end:'2026-11-01T07:30Z'}}
  const r=await scan(db,'update_session',p);assert.equal(r.staffEvents,1);assert.equal(r.childEvents,1)
  await db.exec(`RESET ROLE; UPDATE rejoyce_security.schedule_conflict_reviews SET created_at=clock_timestamp()-interval '11 minutes' WHERE id='${r.reviewId}'`);await actor(db)
  const expired=await save(db,'update_session',p,r.reviewId,ack);assert.ok(expired.review_required)
  await db.exec(`RESET ROLE; INSERT INTO public.user_permissions(user_id,organization_id,can_manage_sessions) VALUES('${ids.staff}','${ids.org}',true)`);await actor(db,ids.staff,ids.staffDevice)
  const foreignActor=await save(db,'update_session',p,expired.review_required.reviewId,ack);assert.ok(foreignActor.review_required)
  const edited=await save(db,'update_session',p,foreignActor.review_required.reviewId,ack);assert.equal(edited.id,ids.session)
  const intent=(await db.query('SELECT workflow_intent FROM public.sessions WHERE id=$1',[ids.session])).rows[0].workflow_intent;assert.equal(intent,'clinical')
 }finally{await db.close()}
})

test('reviewed clinical editing cannot bypass historical and started-session lifecycle guards',async()=>{
 const db=await createFoundationsDatabase();try{
  const edit=async changes=>{const v=(await db.query('SELECT updated_at::text v FROM public.sessions WHERE id=$1',[ids.session])).rows[0].v;return reviewed(db,'update_session',{p_session:ids.session,p_version:v,p_changes:changes})}
  await assert.rejects(edit({status:'completed'}),/provider session controls/)
  await db.exec(`RESET ROLE; ALTER TABLE public.sessions DISABLE TRIGGER USER; UPDATE public.sessions SET status='in_progress',started_at=now(),scheduled_start='2026-11-01T06:00:00.123456Z',scheduled_end='2026-11-01T07:00:00.123456Z' WHERE id='${ids.session}'; ALTER TABLE public.sessions ENABLE TRIGGER USER;`);await actor(db)
  await assert.rejects(edit({scheduled_start:'2026-11-01T06:00:00Z',scheduled_end:'2026-11-01T07:00:00Z'}),/locked after/)
  assert.ok((await edit({location:'Metadata change'})).id)
  assert.equal((await db.query('SELECT scheduled_start::text v FROM public.sessions WHERE id=$1',[ids.session])).rows[0].v.includes('.123456'),true)
  await db.exec(`RESET ROLE; ALTER TABLE public.sessions DISABLE TRIGGER USER; UPDATE public.sessions SET status='completed',completed_at=now() WHERE id='${ids.session}'; ALTER TABLE public.sessions ENABLE TRIGGER USER;`);await actor(db)
  await assert.rejects(edit({location:'Must not change history'}),/Historical/)
 }finally{await db.close()}
})
