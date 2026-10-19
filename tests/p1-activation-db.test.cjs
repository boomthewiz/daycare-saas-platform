/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic database integration tests. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
// These P1 checks are required: a missing fixture must fail, not silently pass via skips.
const value=db=>async(sql,args=[])=>(await db.query(sql,args)).rows[0].value
test('explicit activity and clinical creation preserve receipts, snapshots and legacy preparation',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 try{
  await db.exec(`RESET ROLE;INSERT INTO public.client_targets(organization_id,client_id,title,target_type,response_mode,status) VALUES('${ids.org}','${ids.client}','Synthetic target','discrete_trial','correct_incorrect','active');SET ROLE authenticated;`)
  const tag=await val("SELECT public.save_session_choice('tag','Outdoor play','daycare') value")
  const start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString()
  const args=[ids.client,ids.staff,start,end,'direct_therapy','Garden',[tag],randomUUID(),'activity']
  const query='SELECT public.create_scheduled_context_session($1,$2,$3,$4,$5,$6,$7,$8,$9) value'
  const activity=await val(query,args)
  assert.equal(activity.workflow_intent,'activity');assert.equal(activity.targets_added,0)
  assert.deepEqual(await val(query,args),activity)
  await assert.rejects(val(query,[...args.slice(0,8),'clinical']),{code:'40001'})
  assert.equal(await val('SELECT count(*)::integer value FROM public.session_targets WHERE session_id=$1',[activity.session_id]),0)
  assert.equal(await val('SELECT prepared_at value FROM public.sessions WHERE id=$1',[activity.session_id]),null)
  const context=await val('SELECT public.session_context($1) value',[activity.session_id])
  assert.equal(context.tags[0].label,'Outdoor play');assert.equal(context.recent[0].workflow_intent,'activity')
  const clinical=await val(query,[...args.slice(0,7),randomUUID(),'clinical'])
  assert.equal(clinical.targets_added,1)
  assert.equal(await val('SELECT workflow_intent value FROM public.sessions WHERE id=$1',[clinical.session_id]),'clinical')
  const legacy=await val('SELECT public.create_prepared_session($1,$2,$3,$4,$5,$6) value',args.slice(0,6))
  assert.equal(legacy.targets_added,1)
  const oldContext=await val('SELECT public.create_context_session($1,$2,$3,$4,$5,$6,$7,$8) value',[...args.slice(0,7),randomUUID()])
  assert.equal(oldContext.targets_added,1)
  assert.equal(await val('SELECT workflow_intent value FROM public.sessions WHERE id=$1',[ids.session]),'clinical')
  await assert.rejects(val('SELECT public.prepare_session_targets($1) value',[activity.session_id]),{code:'42501'})
  await assert.rejects(db.query("UPDATE public.sessions SET workflow_intent='clinical' WHERE id=$1",[activity.session_id]),{code:'42501'})
  await assert.rejects(db.query("UPDATE public.sessions SET scheduled_end=scheduled_start-interval '1 minute' WHERE id=$1",[activity.session_id]),{code:'22023'})
  await assert.rejects(db.query("UPDATE public.sessions SET session_type='stale-type' WHERE id=$1",[activity.session_id]),{code:'42501'})
  await assert.rejects(db.query("INSERT INTO public.session_targets(organization_id,session_id,title,target_type,response_mode) VALUES($1,$2,'Invalid','discrete_trial','correct_incorrect')",[ids.org,activity.session_id]),{code:'42501'})
  await actor(db,ids.staff,ids.staffDevice)
  for(const fn of ['start_assigned_session','finish_assigned_session','pause_assigned_session','resume_assigned_session']) await assert.rejects(val(`SELECT public.${fn}($1) value`,[activity.session_id]))
  await assert.rejects(val("SELECT public.mutate_session_note($1,'save',0,$2,'Invalid',NULL,NULL) value",[activity.session_id,randomUUID()]))
  assert.equal((await val('SELECT public.activity_schedule($1) value',[activity.session_id])).child_name,'Synthetic destination')
 }finally{await db.close()}
})
test('activity intent cannot grant clinical client access and preserves all creation restrictions',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 try{
  const query="SELECT public.create_scheduled_context_session($1,$2,now()+interval '1 hour',now()+interval '2 hours',$3,$4,$5,$6,$7) value"
  const args=[ids.sourceClient,ids.staff,'direct_therapy',null,[],randomUUID(),'activity']
  const activity=await val(query,args)
  for(const changed of [[ids.foreignClient,...args.slice(1)],[...args.slice(0,2),'missing',...args.slice(3)],[...args.slice(0,4),[randomUUID()],randomUUID(),'activity'],[...args.slice(0,5),randomUUID(),'unknown']])await assert.rejects(val(query,changed))
  await actor(db,ids.staff,ids.staffDevice)
  assert.equal(await val('SELECT public.can_access_client($1) value',[ids.sourceClient]),false)
  assert.equal(await val('SELECT public.is_assigned_to_client($1) value',[ids.sourceClient]),false)
  assert.equal(await val('SELECT count(*)::integer value FROM public.client_behaviors WHERE client_id=$1',[ids.sourceClient]),0)
  await assert.rejects(val(query,[...args.slice(0,5),randomUUID(),'activity']),{code:'42501'})
  await actor(db)
  await db.exec(`RESET ROLE;INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '30 days',now()-interval '1 day','{}');SET ROLE authenticated;`)
  await assert.rejects(val(query,args),{code:'42501'},'even receipt retries recheck write authority')
  await db.exec(`RESET ROLE;UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}';SET ROLE authenticated;`)
  await assert.rejects(val('SELECT public.activity_schedule($1) value',[activity.session_id]),{code:'42501'})
 }finally{await db.close()}
})
test('activation distinguishes owner configuration, delegated recorder grants and branch membership without visit data',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 try{
  let result=await val('SELECT public.attendance_activation() value')
  assert.equal(result.ready,true);assert.equal(result.ownerReady,true);assert.equal(result.owner,true)
  assert.equal(result.visits,undefined);assert.equal(result.branches[0].hasChild,true)
  await db.exec('RESET ROLE;DELETE FROM rejoyce_security.reporting_settings;SET ROLE authenticated;')
  result=await val('SELECT public.attendance_activation() value');assert.equal(result.timezone,null);assert.equal(result.ready,false)
  await val("SELECT public.set_reporting_timezone('America/Chicago') value")
  result=await val('SELECT public.attendance_activation($1) value',[ids.staff]);assert.equal(result.ready,false);assert.equal(result.view,false);assert.equal(result.branches.some(b=>b.assigned),false)
  await db.exec(`RESET ROLE;INSERT INTO public.user_permissions(organization_id,user_id,can_view_attendance,can_record_attendance,can_correct_attendance) VALUES('${ids.org}','${ids.staff}',false,true,true);SET ROLE authenticated;`)
  await val('SELECT public.set_attendance_scope($1,$2,$3) value',[ids.staff,[ids.north],[]])
  result=await val('SELECT public.attendance_activation($1) value',[ids.staff]);assert.equal(result.ready,false);assert.equal(result.record,true);assert.equal(result.correct,true);assert.equal(result.view,false)
  await actor(db,ids.staff,ids.staffDevice)
  result=await val('SELECT public.attendance_activation() value');assert.equal(result.ready,false);assert.deepEqual(result.staff,[]);assert.equal(result.ownerReady,null)
  await assert.rejects(val('SELECT public.attendance_activation($1) value',[ids.owner]),{code:'42501'})
  await assert.rejects(val('SELECT public.attendance_read($1,current_date,current_date,true) value',[ids.north]),{code:'42501'})
  await db.exec(`RESET ROLE;UPDATE public.user_permissions SET can_view_attendance=true WHERE user_id='${ids.staff}';SET ROLE authenticated;`)
  assert.equal((await val('SELECT public.attendance_activation() value')).ready,true)
  await db.exec(`RESET ROLE;DELETE FROM public.client_locations WHERE location_id='${ids.north}';SET ROLE authenticated;`)
  result=await val('SELECT public.attendance_activation() value');assert.equal(result.ready,false);assert.equal(result.branches[0].hasChild,false)
  await db.exec(`RESET ROLE;UPDATE public.user_permissions SET can_view_attendance=false,can_record_attendance=false,can_correct_attendance=false WHERE user_id='${ids.staff}';SET ROLE authenticated;`)
  await assert.rejects(val('SELECT public.attendance_activation() value'),{code:'42501'})
 }finally{await db.close()}
})
test('scope administrator without attendance View sees configuration only and no private owner readiness',async()=>{
 const db=await createFoundationsDatabase(),val=value(db)
 try{
  await db.exec(`RESET ROLE;UPDATE public.users SET role='admin' WHERE id='${ids.staff}';INSERT INTO public.user_permissions(organization_id,user_id,can_manage_users) VALUES('${ids.org}','${ids.staff}',true);SET ROLE authenticated;`)
  await actor(db,ids.staff,ids.staffDevice)
  const result=await val('SELECT public.attendance_activation() value')
  assert.equal(result.admin,true);assert.equal(result.view,false);assert.equal(result.ready,false);assert.equal(result.ownerReady,true)
  assert.equal(result.staff.some(u=>u.id===ids.owner),false,'protected owner is absent from selectable private staff readiness')
  await assert.rejects(val('SELECT public.attendance_activation($1) value',[ids.owner]),{code:'42501'})
  await assert.rejects(val('SELECT public.attendance_read($1,current_date,current_date,true) value',[ids.north]),{code:'42501'})
  await db.exec(`RESET ROLE;UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.staffDevice}';SET ROLE authenticated;`)
  await assert.rejects(val('SELECT public.attendance_activation() value'),{code:'42501'})
 }finally{await db.close()}
})
