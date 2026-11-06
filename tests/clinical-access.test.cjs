/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic allow/deny integration tests. */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {createClinicalDatabase,approve,ids,actor}=require('./helpers/clinical-access-db.cjs')
const target='80000000-0000-4000-8000-000000000001',note='80000000-0000-4000-8000-000000000002'
async function seed(db){
 await db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);SELECT set_config('request.jwt.claims','{}',false);
 INSERT INTO public.session_targets(id,organization_id,session_id,client_id,title) VALUES('${target}','${ids.org}','${ids.session}','${ids.client}','Synthetic secret target');
 INSERT INTO public.session_notes(id,organization_id,session_id,author_id,final_note) VALUES('${note}','${ids.org}','${ids.session}','${ids.staff}','Synthetic secret note');
 INSERT INTO public.target_responses(organization_id,session_id,session_target_id,provider_id,result) VALUES('${ids.org}','${ids.session}','${target}','${ids.staff}','independent');
 INSERT INTO public.behavior_events(organization_id,session_id,client_id,provider_id,behavior_name) VALUES('${ids.org}','${ids.session}','${ids.client}','${ids.staff}','Synthetic secret behavior');
 INSERT INTO public.session_note_history(organization_id,session_id,note_id,actor_name,action,operation_id,request_payload,snapshot) VALUES('${ids.org}','${ids.session}','${note}','Synthetic actor','save',gen_random_uuid(),'{}','{"final_note":"Synthetic secret history"}');
 INSERT INTO public.session_note_remarks(organization_id,session_id,note_id,author_id,author_name,body,operation_id) VALUES('${ids.org}','${ids.session}','${note}','${ids.staff}','Synthetic staff','Synthetic secret remark',gen_random_uuid());`)
 await actor(db)
}
const denied=/unavailable|permission|policy|Clinical|clinical/i
test('clinical tables and every legacy delivery/note RPC deny unapproved owners; daycare schedule/report remains',async()=>{
 const db=await createClinicalDatabase();try{
  await seed(db)
  for(const t of ['sessions','session_targets','target_responses','behavior_events','session_notes','session_note_history','session_note_remarks'])assert.equal((await db.query(`SELECT * FROM public.${t}`)).rows.length,0,t)
  const calls=[
   ['prepare_session_targets',[ids.session]],['start_assigned_session',[ids.session]],['pause_assigned_session',[ids.session]],['resume_assigned_session',[ids.session]],['finish_assigned_session',[ids.session]],
   ['record_target_response',[target,'independent',null,null]],['record_behavior_event',[ids.session,ids.source,null,null,null]],['undo_latest_behavior_event',[ids.session,ids.source]],
   ['save_assigned_session_note_draft',[ids.session,null,'blocked']],['submit_assigned_session_note',[ids.session]],['approve_session_note',[note,null]],['return_session_note_for_correction',[note,'blocked']],['lock_session_note',[note]],['submit_session_note_for_review',[note]],
   ['mutate_session_note',[ids.session,'approve',1,ids.device,null,null,null]],['append_session_note_remark',[ids.session,'blocked',ids.device]],['swap_session_targets',[ids.session,target,target,0,1]],
   ['create_prepared_session',[ids.client,ids.staff,'2027-01-22T16:00Z','2027-01-22T17:00Z','direct_therapy',null]],
   ['create_context_session',[ids.client,ids.staff,'2027-01-22T16:00Z','2027-01-22T17:00Z','direct_therapy',null,[],ids.device]],
   ['create_scheduled_context_session',[ids.client,ids.staff,'2027-01-22T16:00Z','2027-01-22T17:00Z','direct_therapy',null,[],ids.device,'clinical']],
   ['session_context',[ids.session]],['session_context_v2',[ids.session,[],null]],
  ]
  for(const [f,args] of calls)await assert.rejects(db.query(`SELECT public.${f}(${args.map((_,i)=>'$'+(i+1))})`,args),denied,f)
  const activity=(await db.query("SELECT public.create_scheduled_context_session($1,$2,'2027-01-22T16:00Z','2027-01-22T17:00Z','direct_therapy',NULL,'{}',gen_random_uuid(),'activity') v",[ids.client,ids.staff])).rows[0].v
  assert.ok(activity.session_id);assert.equal((await db.query('SELECT id FROM public.sessions')).rows.length,1)
  const report=(await db.query("SELECT public.operational_report('D3','2027-01-22','2027-01-22') v")).rows[0].v
  assert.ok(!JSON.stringify(report).includes(ids.session));assert.ok(JSON.stringify(report).includes(activity.session_id))
 }finally{await db.close()}
})
test('approved mixed actors keep record eligibility and provider/reviewer rules; live revocation defeats stale writes',async()=>{
 const db=await createClinicalDatabase();try{
  await seed(db);await approve(db)
  assert.equal((await db.query('SELECT * FROM public.session_targets')).rows.length,1)
  assert.equal((await db.query('SELECT * FROM public.session_notes')).rows.length,1)
  await assert.rejects(db.query('SELECT public.start_assigned_session($1)',[ids.session]),/assigned|provider|frontline/i)
  await assert.rejects(db.query("SELECT public.mutate_session_note($1,'save',1,gen_random_uuid(),'blocked',NULL,NULL)",[ids.session]),/assigned|provider|frontline/i)
  await assert.rejects(db.query('SELECT rejoyce_security.require_clinical_session($1)',[ids.session]),/permission denied/)
  await approve(db,ids.staff)
  await db.query('SELECT public.start_assigned_session($1)',[ids.session])
  await db.query("SELECT public.record_target_response($1,'independent',NULL,NULL)",[target])
  assert.equal((await db.query('SELECT * FROM public.target_responses')).rows.length,2)
  await assert.rejects(db.query('SELECT public.prepare_session_targets($1)',[ids.session]),/permission|management/i)
  await db.query('SELECT public.finish_assigned_session($1)',[ids.session])
  const version=(await db.query('SELECT version FROM public.session_notes WHERE id=$1',[note])).rows[0].version
  await db.query("SELECT public.mutate_session_note($1,'save',$2,gen_random_uuid(),'Synthetic reviewed draft',NULL,NULL)",[ids.session,version])
  await assert.rejects(db.query("SELECT public.mutate_session_note($1,'save',$2,gen_random_uuid(),'stale',NULL,NULL)",[ids.session,version]),/changed|reload|version/i)
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.clinical_program_grants SET program_read=false,version=2 WHERE user_id='${ids.staff}'`);await actor(db,ids.staff,ids.staffDevice)
  assert.equal((await db.query('SELECT * FROM public.target_responses')).rows.length,0)
  await assert.rejects(db.query('SELECT public.finish_assigned_session($1)',[ids.session]),denied)
  await assert.rejects(db.query("SELECT public.mutate_session_note($1,'save',1,gen_random_uuid(),'stale',NULL,NULL)",[ids.session]),denied)
  await approve(db);await db.exec(`RESET ROLE;UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}'`);await actor(db)
  assert.equal((await db.query('SELECT * FROM public.session_notes')).rows.length,0)
  await assert.rejects(db.query('SELECT public.prepare_session_targets($1)',[ids.session]),denied)
 }finally{await db.close()}
})
test('care membership, support workforce and presentation settings never grant clinical access; catalog requires separate edit',async()=>{
 const db=await createClinicalDatabase();try{
  await seed(db)
  await db.exec(`RESET ROLE;INSERT INTO rejoyce_security.support_workforce VALUES('${ids.owner}','administrator',true,1);`);await actor(db)
  await db.query("SELECT public.set_account_service_model($1,'mixed',0)",[ids.org])
  assert.equal((await db.query('SELECT public.effective_capabilities() v')).rows[0].v.clinical,false)
  await assert.rejects(db.query('SELECT public.prepare_session_targets($1)',[ids.session]),denied)
  await approve(db)
  await assert.rejects(db.query("INSERT INTO public.target_categories(organization_id,name) VALUES($1,'Synthetic category')",[ids.org]),denied)
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.clinical_program_grants SET program_edit=true WHERE user_id='${ids.owner}'`);await actor(db)
  await db.query("INSERT INTO public.target_categories(organization_id,name) VALUES($1,'Synthetic category')",[ids.org])
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.clinical_program_grants SET program_read=false,program_edit=false,version=2 WHERE user_id='${ids.owner}'`);await actor(db)
  assert.equal((await db.query('SELECT * FROM public.target_categories')).rows.length,0)
  await approve(db,ids.staff)
  await db.exec(`RESET ROLE;INSERT INTO public.client_care_members(organization_id,client_id,user_id) VALUES('${ids.org}','${ids.client}','${ids.staff}') ON CONFLICT DO NOTHING;UPDATE rejoyce_security.clinical_program_grants SET program_read=false WHERE user_id='${ids.staff}'`);await actor(db,ids.staff,ids.staffDevice)
  assert.equal((await db.query('SELECT * FROM public.session_targets')).rows.length,0)
  await assert.rejects(db.query('SELECT public.start_assigned_session($1)',[ids.session]),denied)
 }finally{await db.close()}
})
test('direct/definer writes and foreign records cannot bypass clinical restrictions',async()=>{
 const db=await createClinicalDatabase();try{
  await seed(db)
  await db.exec(`RESET ROLE;CREATE FUNCTION public.synthetic_clinical_writer() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.session_notes SET final_note='blocked' WHERE id='${note}' $$`);await actor(db)
  await assert.rejects(db.query('SELECT public.synthetic_clinical_writer()'),denied)
  assert.equal((await db.query("UPDATE public.session_notes SET final_note='blocked' RETURNING id")).rows.length,0)
  await approve(db)
  await db.exec(`RESET ROLE;UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${ids.owner}'`);await actor(db)
  assert.equal((await db.query('SELECT * FROM public.session_notes')).rows.length,0)
  assert.equal((await db.query('SELECT public.effective_capabilities() v')).rows[0].v.clinical,false)
  await assert.rejects(db.query('SELECT public.prepare_session_targets($1)',[ids.session]),denied)
  await db.exec(`RESET ROLE;UPDATE auth.users SET banned_until=NULL,is_anonymous=true WHERE id='${ids.owner}'`);await actor(db)
  assert.equal((await db.query('SELECT * FROM public.session_targets')).rows.length,0)
  await db.exec(`RESET ROLE;UPDATE auth.users SET is_anonymous=false WHERE id='${ids.owner}'`);await actor(db)
  await assert.rejects(db.query('SELECT public.create_prepared_session($1,$2,now(),now()+interval \'1 hour\')',[ids.foreignClient,ids.staff]),denied)
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.clinical_modules SET enabled=false,version=2`);await actor(db)
  assert.equal((await db.query('SELECT * FROM public.sessions')).rows.length,0)
  await assert.rejects(db.query('SELECT public.synthetic_clinical_writer()'),denied)
 }finally{await db.close()}
})
