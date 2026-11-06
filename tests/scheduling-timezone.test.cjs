/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic timezone tests. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const {civilCandidates,resolveCivil,zonedCivil,dayBoundary,nextCivilDate,addCivilMinutes}=require('./helpers/load-ts.cjs')('lib/scheduling-timezone.ts')
const migration=()=>fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261025012613_scheduling_timezone.sql'),'utf8')
test('civil scheduling is independent of traveling device timezone; gaps, folds and non-hour DST are explicit',()=>{
 for(const device of ['America/Los_Angeles','Asia/Tokyo','UTC']){
  process.env.TZ=device
  assert.deepEqual(civilCandidates('2026-03-08T02:30','America/Chicago'),[])
  const options=civilCandidates('2026-11-01T01:30','America/Chicago')
  assert.deepEqual(options,['2026-11-01T06:30:00.000Z','2026-11-01T07:30:00.000Z'])
  assert.throws(()=>resolveCivil('2026-11-01T01:30','America/Chicago'),/twice/)
  assert.equal(resolveCivil('2026-11-01T01:30','America/Chicago',options[1]),options[1])
  assert.equal(resolveCivil('2026-11-01T01:30','America/Chicago',options[1],options[0]),options[1])
  assert.throws(()=>resolveCivil('2026-03-08T02:30','America/Chicago'),/does not exist/)
  assert.equal(civilCandidates('2026-04-05T01:45','Australia/Lord_Howe').length,2)
  assert.equal(resolveCivil(zonedCivil('2026-10-24T14:32:12.123Z','Asia/Kathmandu'),'Asia/Kathmandu','','2026-10-24T14:32:12.123Z'),'2026-10-24T14:32:12.123Z')
 }
 assert.throws(()=>civilCandidates('2026-02-30T09:00','UTC'),/valid/)
 assert.equal(addCivilMinutes('2026-10-24T23:30',90),'2026-10-25T01:00')
})
test('organization day boundaries are 23/25 hours and overnight calendar clips use organization dates',()=>{
 const {placeEvents}=require('./helpers/load-ts.cjs')('lib/calendar.ts')
 for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]])assert.equal((Date.parse(dayBoundary(nextCivilDate(date),'America/Chicago'))-Date.parse(dayBoundary(date,'America/Chicago')))/3600000,hours)
 process.env.TZ='Asia/Tokyo'
 const event={id:'overnight',scheduled_start:'2026-10-25T04:30Z',scheduled_end:'2026-10-25T05:30Z'}
 assert.deepEqual(placeEvents([event],new Date(2026,9,24),'America/Chicago').map(r=>[r.start,r.end]),[[1410,1440]])
 assert.deepEqual(placeEvents([event],new Date(2026,9,25),'America/Chicago').map(r=>[r.start,r.end]),[[0,30]])
})
test('timezone configuration is explicit, versioned, private, audited and preserves UTC records',async()=>{
 const db=await createFoundationsDatabase();try{
  await db.exec('RESET ROLE');await db.exec(migration());await actor(db)
  const read=async()=>(await db.query('SELECT public.scheduling_timezone() v')).rows[0].v
  const set=async(zone,version,org=ids.org)=>(await db.query('SELECT public.set_scheduling_timezone($1,$2,$3) v',[org,zone,version])).rows[0].v
  assert.equal((await read()).timezone,null)
  const before=(await db.query('SELECT scheduled_start,scheduled_end FROM public.sessions WHERE id=$1',[ids.session])).rows
  assert.equal((await set('America/Chicago',0)).version,1)
  await assert.rejects(set('UTC',0),/changed/)
  await assert.rejects(set('PST',1),/IANA/)
  await assert.rejects(set('Bad/Zone',1),/IANA/)
  await assert.rejects(set('UTC',1,ids.foreignOrg),/configuration/)
  await set('Asia/Tokyo',1)
  assert.deepEqual((await db.query('SELECT scheduled_start,scheduled_end FROM public.sessions WHERE id=$1',[ids.session])).rows,before)
  await db.exec('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.scheduling_timezone_history')).rows[0].n,2)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rejoyce_security' AND c.relname LIKE 'scheduling_timezone_%' AND c.relkind='r' AND c.relrowsecurity AND NOT has_table_privilege('authenticated',c.oid,'SELECT')")).rows[0].n,2)
  await actor(db,ids.staff,ids.staffDevice);await assert.rejects(set('UTC',2),/configuration/)
  await db.exec(`RESET ROLE; UPDATE public.users SET role='admin' WHERE id='${ids.staff}'`);await actor(db,ids.staff,ids.staffDevice);await assert.rejects(set('UTC',2),/configuration/)
  await db.exec(`RESET ROLE; INSERT INTO public.user_permissions(user_id,organization_id,can_manage_users) VALUES('${ids.staff}','${ids.org}',true)`);await actor(db,ids.staff,ids.staffDevice);assert.equal((await set('UTC',2)).updatedBy,ids.staff)
  await db.exec(`RESET ROLE; UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.staffDevice}'`);await actor(db,ids.staff,ids.staffDevice);await assert.rejects(read(),/unlock|sign-in/)
  await db.exec(`RESET ROLE; INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '30 days',now()-interval '1 day','{}')`);await actor(db);await assert.rejects(set('UTC',3),/configuration/)
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(read(),/permission denied/)
 }finally{await db.close()}
})
test('reviewed scheduling validates timezone version and PostgreSQL DST roundtrips',async()=>{
 const db=await createFoundationsDatabase();try{
  await db.exec('RESET ROLE');await db.exec(migration());await actor(db)
  const payload={p_child:ids.client,p_provider:ids.staff,p_start:'2026-11-01T06:30:00Z',p_end:'2026-11-01T08:00:00Z',p_type:'direct_therapy',p_tags:[],p_intent:'activity',p_operation:require('node:crypto').randomUUID()}
  const review=async p=>(await db.query("SELECT public.schedule_conflicts('create_session',$1) v",[p])).rows[0].v
  await assert.rejects(review(payload),/Confirm organization/)
  await db.query("SELECT public.set_scheduling_timezone($1,'America/Chicago',0)",[ids.org])
  await assert.rejects(review(payload),/changed or unverified/)
  const p={...payload,p_clock:{timezone:'America/Chicago',version:1,startLocal:'2026-11-01T01:30',endLocal:'2026-11-01T02:00'}}
  const r=await review(p)
  await assert.rejects(review({...p,p_clock:{...p.p_clock,startLocal:'2026-03-08T02:30'}}),/do not match/)
  const saved=(await db.query("SELECT public.save_reviewed_schedule('create_session',$1,$2,'{}') v",[p,r.reviewId])).rows[0].v
  assert.ok(saved.session_id)
  await db.query("SELECT public.set_scheduling_timezone($1,'Asia/Tokyo',1)",[ids.org])
  await assert.rejects(db.query("SELECT public.save_reviewed_schedule('create_session',$1,$2,'{}')",[p,r.reviewId]),/changed or unverified/)
  await db.exec('RESET ROLE')
  await db.exec("UPDATE rejoyce_security.scheduling_timezone_settings SET timezone='America/Chicago' WHERE organization_id='"+ids.org+"'")
  for(const [instant,hours]of [['2026-03-08T17:00Z',23],['2026-11-01T17:00Z',25]]){
   const bounds=(await db.query('SELECT rejoyce_security.scheduling_day_bounds($1,$2) v',[ids.org,instant])).rows[0].v
   assert.equal((Date.parse(bounds.end)-Date.parse(bounds.start))/3600000,hours)
  }
  await db.exec("UPDATE rejoyce_security.scheduling_timezone_settings SET timezone='America/Havana' WHERE organization_id='"+ids.org+"'")
  const midnight=(await db.query("SELECT rejoyce_security.scheduling_day_bounds($1,'2026-11-01T18:00Z') v",[ids.org])).rows[0].v
  assert.equal((Date.parse(midnight.end)-Date.parse(midnight.start))/3600000,25,'repeated midnight includes the earlier occurrence')
  const options=(await db.query("SELECT rejoyce_security.scheduling_civil_candidates('2026-11-01T01:30','America/Chicago') v")).rows[0].v
  assert.equal(options.length,2)
  await actor(db)
  // Private boundary helper is not directly callable by ordinary clients.
  await assert.rejects(db.query('SELECT rejoyce_security.scheduling_day_bounds($1,now())',[ids.org]),/permission denied/)
 }finally{await db.close()}
})
