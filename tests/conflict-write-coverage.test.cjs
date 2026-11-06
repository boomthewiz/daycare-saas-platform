/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic database coverage. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const clock={timezone:'UTC',version:1,startLocal:'2040-01-02T09:00',endLocal:'2040-01-02T10:00'}
const payload=()=>({p_child:ids.client,p_provider:ids.staff,p_start:'2040-01-02T09:00Z',p_end:'2040-01-02T10:00Z',p_intent:'activity',p_type:'direct_therapy',p_tags:[],p_operation:randomUUID(),p_clock:clock})
const ack={reason:'Reviewed intentional pull-out and assigned staff plan.',staff:true,children:true,uncertainty:true}
async function database(){const db=await createFoundationsDatabase();await db.exec('RESET ROLE');for(const file of ['20261025012613_scheduling_timezone.sql','20261025020957_conflict_write_coverage.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));await actor(db);await db.query("SELECT public.set_scheduling_timezone($1,'UTC',0)",[ids.org]);return db}
async function reviewed(db,action,p){const r=(await db.query('SELECT public.schedule_conflicts($1,$2) v',[action,p])).rows[0].v;return (await db.query('SELECT public.save_reviewed_schedule($1,$2,$3,$4) v',[action,p,r.reviewId,ack])).rows[0].v}
async function legacy(db,p=payload()){return (await db.query('SELECT public.create_scheduled_context_session($1,$2,$3,$4,$5,NULL,$6,$7,$8) v',[p.p_child,p.p_provider,p.p_start,p.p_end,p.p_type,[],p.p_operation,p.p_intent])).rows[0].v}
test('legacy and direct writers cannot bypass overlap review; clean writes and receipts remain supported',async()=>{
 const db=await database();try{
  const p=payload(),first=await legacy(db,p);assert.ok(first.session_id)
  assert.deepEqual(await legacy(db,p),first,'operation receipts remain stable')
  await assert.rejects(legacy(db),/overlaps require/)
  await assert.rejects(db.query("INSERT INTO public.sessions(organization_id,client_id,provider_id,session_type,workflow_intent,scheduled_start,scheduled_end,status) VALUES($1,$2,$3,'direct_therapy','activity','2040-01-02T09:30Z','2040-01-02T10:30Z','scheduled')",[ids.org,ids.client,ids.staff]),/overlaps require/)
  // Legacy clinical wrappers reach the same table gate, including the older prepared endpoint.
  await assert.rejects(db.query("SELECT public.create_context_session($1,$2,'2040-01-02T09:15Z','2040-01-02T10:15Z','direct_therapy',NULL,'{}',gen_random_uuid())",[ids.client,ids.staff]),/overlaps require/)
  await assert.rejects(db.query("SELECT public.create_prepared_session($1,$2,'2040-01-02T09:15Z','2040-01-02T10:15Z','direct_therapy',NULL)",[ids.client,ids.staff]),/overlaps require/)
  const second=await reviewed(db,'create_session',payload());assert.ok(second.session_id,'planned overlap can still be explicitly acknowledged')
  await db.exec('RESET ROLE')
  const audit=(await db.query('SELECT * FROM rejoyce_security.schedule_write_audit ORDER BY recorded_at')).rows
  assert.equal(audit.length,2);assert.equal(audit[0].review_id,null);assert.ok(audit[1].review_id)
  assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.schedule_conflict_acknowledgements')).rows[0].n,1)
 }finally{await db.close()}
})
test('group final-roster gate rejects legacy overlaps; reviewed pull-outs preserve immutable snapshots',async()=>{
 const db=await database();try{
  const c=(await db.query('SELECT public.save_activity_class(NULL,NULL,$1,$2,$3,$4,true) v',['Coverage class',ids.north,[ids.client],[ids.staff]])).rows[0].v
  const group=()=>({p_class:c.id,p_version:1,p_title:'Group play',p_children:[ids.client],p_staff:[ids.staff],p_start:'2040-01-02T09:00Z',p_end:'2040-01-02T10:00Z',p_type:'direct_therapy',p_location:null,p_operation:randomUUID(),p_clock:clock})
  await legacy(db)
  await assert.rejects(db.query("SELECT public.create_group_activity($1,1,'Group play',$2,$3,'2040-01-02T09:00Z','2040-01-02T10:00Z','direct_therapy',NULL,gen_random_uuid())",[c.id,[ids.client],[ids.staff]]),/overlaps require/)
  const saved=await reviewed(db,'create_group',group());assert.ok(saved.session_id)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.group_activities')).rows[0].n,1,'failed group and roster were rolled back')
  assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.group_activity_children')).rows[0].n,1)
  await assert.rejects(db.query('DELETE FROM rejoyce_security.group_activity_children WHERE activity_id=$1',[saved.session_id]),/immutable/)
  await assert.rejects(db.query("UPDATE rejoyce_security.group_activity_staff SET name_snapshot='Changed' WHERE activity_id=$1",[saved.session_id]),/immutable/)
  await assert.rejects(db.query("INSERT INTO rejoyce_security.group_activity_children VALUES($1,$2,$3,'Late addition')",[ids.org,saved.session_id,ids.sourceClient]),/immutable/)
  assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.schedule_group_creations')).rows[0].n,0)
  await actor(db)
  const clear=(await db.query("SELECT public.create_group_activity($1,1,'Later group',$2,$3,'2040-01-03T09:00Z','2040-01-03T10:00Z','direct_therapy',NULL,gen_random_uuid()) v",[c.id,[ids.client],[ids.staff]])).rows[0].v
  await assert.rejects(db.query("SELECT public.update_group_activity($1,1,'2040-01-02T09:00Z','2040-01-02T10:00Z',NULL,'confirmed')",[clear.session_id]),/overlaps require/)
  const edit={p_activity:clear.session_id,p_version:1,p_start:'2040-01-02T09:00Z',p_end:'2040-01-02T10:00Z',p_location:null,p_status:'confirmed',p_clock:clock}
  assert.equal((await reviewed(db,'update_group',edit)).version,2)
 }finally{await db.close()}
})
test('multirow writes are atomic and unsupported transaction snapshots fail closed',async()=>{
 const db=await database();try{
  await assert.rejects(db.query("INSERT INTO public.sessions(organization_id,client_id,provider_id,session_type,workflow_intent,scheduled_start,scheduled_end,status) SELECT $1,$2,$3,'direct_therapy','activity','2040-02-01T09:00Z','2040-02-01T10:00Z','scheduled' FROM generate_series(1,2)",[ids.org,ids.client,ids.staff]),/overlaps require/)
  assert.equal((await db.query("SELECT id FROM public.sessions WHERE scheduled_start='2040-02-01T09:00Z'")).rows.length,0)
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ')
  await assert.rejects(legacy(db),/read committed/)
  await db.exec('ROLLBACK')
 }finally{await db.close()}
})
test('direct rescheduling, forged context, deletions and historical edits are guarded',async()=>{
 const db=await database();try{
  const first=await legacy(db),p={...payload(),p_start:'2040-01-02T11:00Z',p_end:'2040-01-02T12:00Z'}
  const second=await legacy(db,p)
  await db.query("SELECT set_config('rejoyce.reviewed','true',false)")
  await assert.rejects(db.query("UPDATE public.sessions SET scheduled_start='2040-01-02T09:30Z',scheduled_end='2040-01-02T10:30Z' WHERE id=$1",[second.session_id]),/overlaps require/)
  assert.equal((await db.query('DELETE FROM public.sessions WHERE id=$1 RETURNING id',[second.session_id])).rows.length,0,'existing RLS does not permit direct deletion')
  assert.equal((await db.query('SELECT id FROM public.sessions WHERE id=$1',[second.session_id])).rows.length,1)
  await db.query("UPDATE public.sessions SET status='canceled' WHERE id=$1",[second.session_id])
  await assert.rejects(db.query("UPDATE public.sessions SET status='scheduled' WHERE id=$1",[second.session_id]),/Historical/)
  await actor(db,ids.staff,ids.staffDevice);await assert.rejects(legacy(db),/management|authorized|permission|access/i)
  await actor(db);await db.exec(`RESET ROLE;UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}'`);await actor(db);await assert.rejects(legacy(db),/unlock|sign-in/)
  assert.ok(first.session_id)
 }finally{await db.close()}
})
test('audit and permits stay private; stale draft pruning retains reviewed clean-save evidence',async()=>{
 const db=await database();try{
  await reviewed(db,'create_session',payload())
  await db.exec("RESET ROLE;UPDATE rejoyce_security.schedule_conflict_reviews SET created_at=now()-interval '2 days'")
  await actor(db);await db.query("SELECT public.schedule_conflicts('create_session',$1)",[payload()])
  await assert.rejects(db.query('SELECT * FROM rejoyce_security.schedule_write_permits'),/permission denied/)
  await assert.rejects(db.query('SELECT * FROM rejoyce_security.schedule_write_audit'),/permission denied/)
  await assert.rejects(db.query("SELECT rejoyce_security.check_schedule_write('{}',gen_random_uuid(),'INSERT',true)"),/permission denied/)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.schedule_write_audit')).rows[0].n,1)
  assert.ok((await db.query("SELECT bool_and(relrowsecurity) ok FROM pg_class WHERE relname IN ('schedule_write_audit','schedule_write_permits','schedule_group_creations')")).rows[0].ok)
 }finally{await db.close()}
})
