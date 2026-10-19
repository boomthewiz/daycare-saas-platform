require('./setup.cjs')
/* eslint-disable @typescript-eslint/no-require-imports -- Independent local PostgreSQL connections. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto')
test('independent PostgreSQL transactions serialize duplicate check-ins, retries and stale corrections',{skip:false},async()=>{
 const dbName=`attendance_test_${process.pid}`
 const postgres=require(process.env.REJOYCE_POSTGRES_CLIENT)
 const run=async(sql,database=dbName)=>{
  const client=postgres({host:'127.0.0.1',port:55439,username:'postgres',database,max:1,prepare:false,onnotice:()=>{}})
  try{const result=await client.unsafe(sql).simple();const rows=Array.isArray(result[0])?result.at(-1):result;const value=rows?.[0]?Object.values(rows[0])[0]:'';return value instanceof Date?value.toISOString():value&&typeof value==='object'?JSON.stringify(value):String(value)}finally{await client.end({timeout:1})}
 };
 await run(`CREATE DATABASE ${dbName};`,'postgres')
 const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',device='33333333-3333-4333-8333-333333333333',client='44444444-4444-4444-8444-444444444444',branch='55555555-5555-4555-8555-555555555555'
 const auth=`SELECT set_config('request.jwt.claim.sub','${user}',false); SELECT set_config('request.jwt.claims','${JSON.stringify({sub:user,session_id:device,role:'authenticated'})}',false);SET ROLE authenticated;`
 try{
  await run(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;DO $$ BEGIN CREATE ROLE supabase_auth_admin; EXCEPTION WHEN duplicate_object THEN NULL; END $$;DO $$ BEGIN CREATE ROLE supabase_admin; EXCEPTION WHEN duplicate_object THEN NULL; END $$;DO $$ BEGIN CREATE ROLE authenticator; EXCEPTION WHEN duplicate_object THEN NULL; END $$;CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb,invited_at timestamptz,email_confirmed_at timestamptz,banned_until timestamptz);
   CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz,created_at timestamptz DEFAULT now(),aal text);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT auth.jwt()->>'role'$$;
   GRANT USAGE ON SCHEMA auth TO authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;`)
  await run(fs.readFileSync(process.env.REJOYCE_BASELINE_SQL,'utf8'))
  for(const file of ['20261004053317_client_care_teams.sql','20261008061322_onboarding_progress.sql','20261017192817_daycare_operational_reports.sql','20261017192818_correct_canceled_onboarding_milestone.sql','20261018084149_branch_attendance.sql','20261018084157_session_context_tags.sql','20261019194610_p1_activity_and_attendance_activation.sql','20261019202944_p2_scheduling_reliability.sql'])await run(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'))
  await run(`INSERT INTO rejoyce_security.session_policy(singleton,enforced) VALUES(true,true) ON CONFLICT(singleton) DO UPDATE SET enforced=true;
   INSERT INTO public.organizations(id,name) VALUES('${org}','Concurrent synthetic');INSERT INTO auth.users(id,email) VALUES('${user}','synthetic@example.invalid');
   INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required) VALUES('${user}','${org}','owner','active','synthetic',false);
   INSERT INTO auth.sessions(id,user_id) VALUES('${device}','${user}');INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${device}','${user}',now(),now(),now()+interval '1 hour');
   INSERT INTO public.clients(id,organization_id,first_name,status) VALUES('${client}','${org}','Concurrent child','active');INSERT INTO public.organization_locations(id,organization_id,name) VALUES('${branch}','${org}','North');
   INSERT INTO public.client_locations(organization_id,client_id,location_id) VALUES('${org}','${client}','${branch}');INSERT INTO rejoyce_security.reporting_settings(organization_id,timezone,updated_by) VALUES('${org}','America/Chicago','${user}');`)
  const checkin=op=>`${auth}SELECT public.attendance_mutate('check_in','${client}','${branch}',p_operation:='${op}');`
  const raced=await Promise.allSettled([run(checkin(randomUUID())),run(checkin(randomUUID()))])
  assert.equal(raced.filter(result=>result.status==='fulfilled').length,1,'only one distinct check-in commits')
  assert.equal(await run('SELECT count(*) FROM rejoyce_security.attendance_events'), '1')
  const visit=JSON.parse(await run('SELECT row_to_json(v) FROM rejoyce_security.attendance_visits v LIMIT 1'))
  const closeOp=randomUUID(),close=`${auth}SELECT public.attendance_mutate('check_out',p_visit:='${visit.id}',p_version:=1,p_operation:='${closeOp}');`
  const retries=await Promise.all([run(close),run(close)])
  assert.equal(retries[0],retries[1],'same-operation concurrent retries return identical receipts')
  assert.equal(await run('SELECT count(*) FROM rejoyce_security.attendance_events'), '2')
  const correction=()=>`${auth}SELECT public.attendance_mutate('correct',p_branch:='${branch}',p_visit:='${visit.id}',p_version:=2,p_in:='${visit.check_in}',p_out:=(SELECT check_out FROM rejoyce_security.attendance_visits LIMIT 1),p_reason:='Concurrent correction',p_operation:='${randomUUID()}');`
  // Pass the closed instant as data, never read a private table from the caller role.
  const closed=await run('SELECT check_out FROM rejoyce_security.attendance_visits LIMIT 1')
  const edits=await Promise.allSettled([run(correction().replace('(SELECT check_out FROM rejoyce_security.attendance_visits LIMIT 1)',`'${closed}'::timestamptz`)),run(correction().replace('(SELECT check_out FROM rejoyce_security.attendance_visits LIMIT 1)',`'${closed}'::timestamptz`))])
  assert.equal(edits.filter(result=>result.status==='fulfilled').length,1,'one correction wins and the stale editor is rejected')
  assert.equal(await run('SELECT count(*) FROM rejoyce_security.attendance_events'),'3')
  await run(`INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES('${org}','Play','play',60)`)
  const creation=op=>`${auth}SELECT public.create_scheduled_context_session('${client}','${user}','2026-10-20T12:00:00Z','2026-10-20T13:00:00Z','play',NULL,'{}','${op}','activity')`
  const sessionOp=randomUUID(),created=await Promise.all([run(creation(sessionOp)),run(creation(sessionOp))]);assert.equal(created[0],created[1])
  const racing=randomUUID(),outcome=await Promise.allSettled([run(creation(racing)),run(`${auth}SELECT public.recover_session_creation('${racing}',true)`)]),recovered=JSON.parse(outcome[1].value)
  assert.ok(['committed','canceled'].includes(recovered.state))
  assert.equal(await run(`SELECT count(*) FROM rejoyce_security.session_creation_operations WHERE operation_id='${racing}'`),recovered.state==='committed'?'1':'0')
  if(recovered.state==='canceled')assert.equal(outcome[0].status,'rejected','cancel-first fences delayed creation')

 }finally{await run(`DROP DATABASE ${dbName};`,'postgres')}
})
