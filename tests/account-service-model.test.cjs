/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic PostgreSQL. */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const {scheduleKind,scheduleLabel,matchesFocus,modelDefaults}=require('./helpers/load-ts.cjs')('lib/schedule-intent.ts')
test('calendar separates saved intent from group shape and vocabulary for every model',()=>{
 const records=[{workflow_intent:'clinical'},{workflow_intent:'activity'},{workflow_intent:'activity',group_activity:true}]
 for(const model of ['unconfirmed','daycare','aba','mixed']) {
  assert.deepEqual(records.map(scheduleKind),['clinical','individual','group'])
  assert.deepEqual(records.map(scheduleLabel),['ABA session','Individual Activity','Group Activity'])
  assert.deepEqual(records.map(r=>matchesFocus(r,'sessions')),[true,false,false])
  assert.deepEqual(records.map(r=>matchesFocus(r,'activities')),[false,true,true])
  assert.deepEqual(records.map(r=>matchesFocus(r,'classes')),[false,false,true])
  assert.ok(records.every(r=>matchesFocus(r,'all')))
  assert.ok(modelDefaults(model).focus)
 }
 assert.deepEqual(modelDefaults('unconfirmed'),{focus:'all',kind:'individual',day:false})
 assert.deepEqual(modelDefaults('mixed'),{focus:'all',kind:null,day:false})
 assert.equal(scheduleLabel({}),'Scheduled work','unknown intent is never guessed as clinical')
})
test('explicit versioned confirmation preserves saved clinical, individual and group records',async()=>{
 const db=await createFoundationsDatabase();try{
  const read=async()=>(await db.query('SELECT public.account_service_model() v')).rows[0].v
  const set=async(model,version,org=ids.org)=>(await db.query('SELECT public.set_account_service_model($1,$2,$3) v',[org,model,version])).rows[0].v
  assert.equal((await read()).model,'unconfirmed');assert.equal((await read()).version,0)
  const c=(await db.query('SELECT public.save_activity_class(NULL,NULL,$1,$2,$3,$4,true) v',['Class',ids.north,[ids.client],[ids.staff]])).rows[0].v
  await db.query("SELECT public.create_group_activity($1,1,'Play',$2,$3,'2026-10-22T14:00Z','2026-10-22T15:00Z','direct_therapy',NULL,gen_random_uuid())",[c.id,[ids.client],[ids.staff]])
  await db.query("SELECT public.create_scheduled_context_session($1,$2,'2026-10-22T16:00Z','2026-10-22T17:00Z','direct_therapy',NULL,'{}',gen_random_uuid(),'activity')",[ids.client,ids.staff])
  const snapshot=async()=>{await db.exec('RESET ROLE');const result=(await db.query("SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sessions s) sessions,(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM rejoyce_security.group_activities g) groups,(SELECT jsonb_agg(to_jsonb(c) ORDER BY activity_id,child_id) FROM rejoyce_security.group_activity_children c) children")).rows[0];await actor(db);return result}
  const before=await snapshot()
  for(const [version,model] of ['daycare','aba','mixed'].entries()) {
   const result=await set(model,version);assert.equal(result.model,model);assert.equal(result.version,version+1);assert.equal(result.updatedBy,ids.owner)
   assert.deepEqual(await snapshot(),before)
   await assert.rejects(set('daycare',version),/changed/)
  }
  await assert.rejects(set('unconfirmed',3),/Choose/)
  await assert.rejects(set('mixed',3,ids.foreignOrg),/configuration/)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.service_model_history')).rows[0].n,3)
  const wrappers=(await db.query("SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('account_service_model','set_account_service_model')")).rows
  assert.equal(wrappers.length,2);assert.ok(wrappers.every(r=>!r.prosecdef&&!r.anon))
  const tables=(await db.query("SELECT c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT') exposed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rejoyce_security' AND c.relname IN ('service_model_settings','service_model_history')")).rows
  assert.equal(tables.length,2);assert.ok(tables.every(r=>r.relrowsecurity&&!r.exposed))
 }finally{await db.close()}
})
test('account configuration requires live grants, tenant, unlocked device and subscription',async()=>{
 const db=await createFoundationsDatabase();try{
  const set=async()=>(await db.query("SELECT public.set_account_service_model($1,'mixed',0) v",[ids.org])).rows[0].v
  await actor(db,ids.staff,ids.staffDevice)
  assert.equal((await db.query('SELECT public.account_service_model() v')).rows[0].v.canManage,false)
  await assert.rejects(set(),/configuration/)
  await db.exec(`RESET ROLE; UPDATE public.users SET role='admin' WHERE id='${ids.staff}'`);await actor(db,ids.staff,ids.staffDevice)
  await assert.rejects(set(),/configuration/,'admin label alone is insufficient')
  await db.exec(`RESET ROLE; INSERT INTO public.user_permissions(user_id,organization_id,can_manage_users) VALUES('${ids.staff}','${ids.org}',true)`);await actor(db,ids.staff,ids.staffDevice)
  assert.equal((await set()).updatedBy,ids.staff)
  await db.exec(`RESET ROLE; UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.staffDevice}'`);await actor(db,ids.staff,ids.staffDevice)
  await assert.rejects(db.query('SELECT public.account_service_model()'),/unlock|sign-in/)
  await assert.rejects(set(),/unlock|sign-in/)
  await db.exec(`RESET ROLE; INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '30 days',now()-interval '1 day','{}')`);await actor(db)
  await assert.rejects(set(),/configuration/)
  assert.equal((await db.query('SELECT public.account_service_model() v')).rows[0].v.canWrite,false)
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(db.query('SELECT public.account_service_model()'),/permission denied/)
 }finally{await db.close()}
})

test('all four models retain manager, assigned and unauthorized access boundaries for all three record kinds',async()=>{
 const db=await createFoundationsDatabase();try{
  const c=(await db.query('SELECT public.save_activity_class(NULL,NULL,$1,$2,$3,$4,true) v',['Matrix class',ids.north,[ids.client],[ids.staff]])).rows[0].v
  const group=(await db.query("SELECT public.create_group_activity($1,1,'Group',$2,$3,'2026-10-22T14:00Z','2026-10-22T15:00Z','direct_therapy',NULL,gen_random_uuid()) v",[c.id,[ids.client],[ids.staff]])).rows[0].v.session_id
  const individual=(await db.query("SELECT public.create_scheduled_context_session($1,$2,'2026-10-22T16:00Z','2026-10-22T17:00Z','direct_therapy',NULL,'{}',gen_random_uuid(),'activity') v",[ids.client,ids.staff])).rows[0].v.session_id
  for(const [index,model] of ['unconfirmed','daycare','aba','mixed'].entries()) {
   await actor(db)
   if(index)await db.query('SELECT public.set_account_service_model($1,$2,$3)',[ids.org,model,index-1])
   for(const access of ['manager','assigned','unauthorized']) {
    if(access==='unauthorized'){await db.exec(`RESET ROLE; UPDATE public.users SET role='teacher' WHERE id='${ids.owner}'`);await actor(db)}
    else await actor(db,access==='assigned'?ids.staff:ids.owner,access==='assigned'?ids.staffDevice:ids.device)
    assert.equal((await db.query('SELECT public.account_service_model() v')).rows[0].v.model,model)
    assert.equal((await db.query('SELECT id FROM public.sessions WHERE id=$1',[ids.session])).rows.length,access==='unauthorized'?0:1,`${model}/${access}/clinical`)
    for(const id of [individual,group]){
     if(access==='unauthorized')await assert.rejects(db.query('SELECT public.activity_schedule($1)',[id]),/unavailable/)
     else assert.equal((await db.query('SELECT public.activity_schedule($1) v',[id])).rows[0].v.workflow_intent,'activity')
    }
    if(access==='unauthorized')await db.exec(`RESET ROLE; UPDATE public.users SET role='owner' WHERE id='${ids.owner}'`)
   }
  }
 }finally{await db.close()}
})
