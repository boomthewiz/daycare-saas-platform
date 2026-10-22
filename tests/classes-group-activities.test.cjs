/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic PostgreSQL. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const extra='20000000-0000-4000-8000-000000000009'
async function fixture(){
 const db=await createFoundationsDatabase()
 await db.exec('RESET ROLE')
 await db.exec(`INSERT INTO auth.users(id,email) VALUES('${extra}','group@example.invalid');
 INSERT INTO public.users(id,organization_id,full_name,email,role,status,pin_hash,pin_reset_required) VALUES('${extra}','${ids.org}','Group worker','group@example.invalid','teacher','active','synthetic',false);
 INSERT INTO auth.sessions(id,user_id) VALUES('${extra}','${extra}');
 INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${extra}','${extra}',now(),now(),now()+interval '1 day');
 INSERT INTO public.client_locations(organization_id,client_id,location_id) VALUES('${ids.org}','${ids.sourceClient}','${ids.north}');`)
 await actor(db)
 const save=async(id=null,version=null,name='Preschool',children=[ids.client,ids.sourceClient],staff=[ids.staff,extra],active=true)=>(await db.query('SELECT public.save_activity_class($1,$2,$3,$4,$5,$6,$7) v',[id,version,name,ids.north,children,staff,active])).rows[0].v
 const c=await save()
 const create=async(op=randomUUID(),version=c.version,children=[ids.client,ids.sourceClient],staff=[ids.staff,extra],classId=c.id)=>(await db.query('SELECT public.create_group_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v',[classId,version,'Outdoor play',children,staff,'2026-10-22T14:00:00Z','2026-10-22T15:00:00Z','direct_therapy','Garden',op])).rows[0].v
 return {db,save,c,create}
}
test('one class drives group scheduling; roster snapshots survive class edits and archives',async()=>{
 const {db,save,c,create}=await fixture();try{
  const result=await create(),id=result.session_id
  const context=(await db.query('SELECT public.activity_class_context() v')).rows[0].v
  assert.equal(context.classes[0].child_ids.length,2)
  const schedule=async()=>(await db.query('SELECT public.activity_schedule($1) v',[id])).rows[0].v
  assert.equal((await schedule()).children.length,2);assert.equal((await schedule()).staff.length,2)
  await save(c.id,1,'Renamed class',[ids.sourceClient],[extra],false)
  const a=await schedule();assert.equal(a.class_name,'Preschool');assert.equal(a.children.length,2)
  await assert.rejects(create(randomUUID(),1),/unavailable/)
  await db.exec('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.group_activities')).rows[0].n,1)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.sessions')).rows[0].n,1,'group is not duplicated as per-child service records')
 }finally{await db.close()}
})
test('group retry/recovery and cancellation use the shared operation fence',async()=>{
 const {db,c,create}=await fixture();try{
  const op=randomUUID(),first=await create(op);assert.deepEqual(await create(op),first)
  assert.equal((await db.query('SELECT public.recover_session_creation($1,false) v',[op])).rows[0].v.session_id,first.session_id)
  await assert.rejects(create(op,c.version,[ids.client]),/different details/)
  const canceled=randomUUID();await db.query('SELECT public.recover_session_creation($1,true)',[canceled]);await assert.rejects(create(canceled),/canceled/)
 }finally{await db.close()}
})
test('class and group writes reject foreign, stale, inactive and out-of-branch selections',async()=>{
 const {db,c,create,save}=await fixture();try{
  await assert.rejects(create(randomUUID(),c.version,[ids.foreignClient]),/Every child/)
  await assert.rejects(create(randomUUID(),c.version,[ids.client],[]),/required/)
  await assert.rejects(create(randomUUID(),c.version,[ids.client],[ids.owner]),/staff required/)
  await assert.rejects(create(randomUUID(),c.version,[null]),/Choose at most/)
  await assert.rejects(create(randomUUID(),c.version,[ids.client],[extra],randomUUID()),/unavailable/)
  await save(c.id,1);await assert.rejects(create(randomUUID(),1),/roster changed/)
  await assert.rejects(save(c.id,1),/Class changed/)
  await db.exec(`RESET ROLE; UPDATE public.users SET role='owner' WHERE id='${extra}'`);await actor(db)
  const unavailable=(await db.query('SELECT public.activity_class_context() v')).rows[0].v.staff.find(person=>person.id===extra)
  assert.equal(unavailable.active,false,'unavailable saved staff stay visible and removable')
  await db.exec(`RESET ROLE; UPDATE public.users SET role='teacher' WHERE id='${extra}'`);await actor(db)
  await db.exec(`RESET ROLE; UPDATE public.clients SET status='inactive' WHERE id='${ids.sourceClient}'`);await actor(db)
  await assert.rejects(create(randomUUID(),2),/Every child/)
  await db.exec(`RESET ROLE; DELETE FROM public.client_locations WHERE client_id='${ids.client}'`);await actor(db)
  await assert.rejects(create(randomUUID(),2,[ids.client]),/Every child/)
 }finally{await db.close()}
})
test('secondary assigned staff see the group once without clinical profile authority; other staff and locked actors are denied',async()=>{
 const {db,create}=await fixture();try{
  const id=(await create()).session_id
  await actor(db,extra,extra)
  assert.equal((await db.query('SELECT public.activity_schedule($1) v',[id])).rows[0].v.children.length,2)
  assert.equal((await db.query('SELECT public.list_group_activities(p_assigned:=true) v')).rows[0].v.rows.length,1)
  assert.equal((await db.query('SELECT public.can_access_client($1) v',[ids.sourceClient])).rows[0].v,false)
  await assert.rejects(db.query('SELECT public.activity_class_context()'),/management required/)
  await assert.rejects(db.query('SELECT * FROM rejoyce_security.group_activity_children'),/permission denied/)
  await db.exec(`RESET ROLE; DELETE FROM rejoyce_security.group_activity_staff WHERE user_id='${extra}'`);await actor(db,extra,extra)
  await assert.rejects(db.query('SELECT public.activity_schedule($1)',[id]),/unavailable/)
  assert.equal((await db.query('SELECT public.list_group_activities() v')).rows[0].v.rows.length,0)
  await db.exec(`RESET ROLE; UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE user_id='${extra}'`);await actor(db,extra,extra)
  await assert.rejects(db.query('SELECT public.list_group_activities()'),/unlock|PIN|locked/i)
 }finally{await db.close()}
})
test('calendar/list/report scopes and versioned group schedule edits retain one event',async()=>{
 const {db,create}=await fixture();try{
  const id=(await create()).session_id
  assert.equal((await db.query('SELECT public.list_group_activities(p_branch:=$1) v',[ids.south])).rows[0].v.rows.length,0)
  assert.equal((await db.query('SELECT public.list_group_activities(p_child:=$1) v',[ids.sourceClient])).rows[0].v.rows.length,1)
  const report=(await db.query("SELECT public.operational_report('D3','2026-10-22','2026-10-22') v")).rows[0].v
  assert.equal(report.rows.filter(row=>row.id===id).length,1)
  await db.query("SELECT public.update_group_activity($1,1,'2026-10-22T15:00Z','2026-10-22T16:00Z','Hall','confirmed')",[id])
  await assert.rejects(db.query("SELECT public.update_group_activity($1,1,now(),now()+interval '1 hour',NULL,'canceled')",[id]),/changed/)
  await assert.rejects(db.query("SELECT public.update_group_activity($1,2,now(),now()-interval '1 hour',NULL,'confirmed')",[id]),/check constraint/)
  await db.query("SELECT public.update_group_activity($1,2,now(),now()+interval '1 hour',NULL,'canceled')",[id])
  assert.equal((await db.query('SELECT public.activity_schedule($1) v',[id])).rows[0].v.children.length,2)
 }finally{await db.close()}
})
test('anonymous callers and read-only subscriptions cannot mutate Classes or group activities',async()=>{
 const {db,create,save}=await fixture();try{
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(db.query('SELECT public.activity_class_context()'),/permission denied/)
  await db.exec(`RESET ROLE; INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '30 days',now()-interval '1 day','{}')`)
  await actor(db)
  await assert.rejects(save(),/management and editing/);await assert.rejects(create(),/management and editing/)
  await db.exec('RESET ROLE; DELETE FROM rejoyce_security.organization_subscriptions')
  // Current grant revocation is checked in the database, independently of UI state.
  await db.exec(`UPDATE public.users SET role='staff' WHERE id='${ids.owner}'`);await actor(db)
  await assert.rejects(save(),/management and editing/);await assert.rejects(create(),/management and editing/)
 }finally{await db.close()}
})
test('foreign organizations cannot resolve class/activity IDs and new storage is RPC-only with RLS',async()=>{
 const {db,c,create}=await fixture();try{
  const id=(await create()).session_id,foreign='20000000-0000-4000-8000-000000000010'
  await db.exec('RESET ROLE')
  const unsafe=(await db.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('activity_class_context','save_activity_class','create_group_activity','list_group_activities','update_group_activity','report_group_activities') AND (p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE'))")).rows[0].n
  assert.equal(unsafe,0)
  const tables=(await db.query("SELECT c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT') exposed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rejoyce_security' AND c.relname IN ('activity_classes','activity_class_children','activity_class_staff','group_activities','group_activity_children','group_activity_staff','activity_roster_history')")).rows
  assert.equal(tables.length,7);assert.ok(tables.every(table=>table.relrowsecurity&&!table.exposed))
  await db.exec(`INSERT INTO auth.users(id,email) VALUES('${foreign}','foreign@example.invalid');INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required) VALUES('${foreign}','${ids.foreignOrg}','owner','active','synthetic',false);INSERT INTO auth.sessions(id,user_id) VALUES('${foreign}','${foreign}');INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${foreign}','${foreign}',now(),now(),now()+interval '1 hour')`)
  await actor(db,foreign,foreign)
  assert.equal((await db.query('SELECT public.activity_class_context() v')).rows[0].v.classes.length,0)
  assert.equal((await db.query('SELECT public.list_group_activities() v')).rows[0].v.rows.length,0)
  await assert.rejects(db.query('SELECT public.activity_schedule($1)',[id]),/unavailable/)
  await assert.rejects(create(undefined,c.version),/Class unavailable/)
 }finally{await db.close()}
})
