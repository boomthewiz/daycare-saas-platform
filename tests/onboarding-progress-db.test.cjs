/* eslint-disable @typescript-eslint/no-require-imports -- Offline PostgreSQL integration tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { loadCareDatabase, applyCareMigration } = require('./helpers/care-db.cjs')
test('live onboarding separates acceptance and account readiness, scopes summaries and preserves device/access boundaries', {
  skip: !process.env.REJOYCE_BASELINE_SQL || !process.env.REJOYCE_PGLITE_MODULE,
}, async () => {
  const db = await loadCareDatabase()
  try {
    await applyCareMigration(db)
    await db.exec('ALTER TABLE auth.users ADD COLUMN invited_at timestamptz, ADD COLUMN email_confirmed_at timestamptz, ADD COLUMN banned_until timestamptz;')
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261008061322_onboarding_progress.sql'),'utf8'))
    const org='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
    const actor='33333333-3333-4333-8333-333333333333', sid='44444444-4444-4444-8444-444444444444'
    const worker='55555555-5555-4555-8555-555555555555', branch='66666666-6666-4666-8666-666666666666', client='77777777-7777-4777-8777-777777777777'
    await db.exec(`INSERT INTO public.organizations(id,name) VALUES('${org}','Synthetic setup'),('${other}','Other');
      INSERT INTO auth.users(id,email,email_confirmed_at,invited_at) VALUES('${actor}','owner@example.invalid',now(),NULL),('${worker}','staff@example.invalid',NULL,now());
      INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required) VALUES('${actor}','${org}','owner','active','synthetic',false),('${worker}','${org}','teacher','active',NULL,true);
      INSERT INTO auth.sessions(id,user_id) VALUES('${sid}','${actor}');
      INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${sid}','${actor}',now(),now(),now()+interval '1 hour');
      SELECT set_config('request.jwt.claim.sub','${actor}',false);
      SELECT set_config('request.jwt.claims','${JSON.stringify({sub:actor,session_id:sid,role:'authenticated'})}',false); SET ROLE authenticated;`)
    const progress=async(details=false)=>(await db.query('SELECT public.onboarding_progress($1) value',[details])).rows[0].value
    let p=await progress(true)
    for(const key of ['branch','client','care','session_type','staff_ready','scheduled']) assert.equal(p[key],false,key)
    assert.equal(p.staff.find(s=>s.id===worker).invitation,'pending')
    assert.equal(p.staff.find(s=>s.id===actor).ready,false,'owner is not frontline')
    assert.equal((await progress()).staff.length,0,'summary never exposes staff identities')
    await db.exec(`RESET ROLE; UPDATE auth.users SET email_confirmed_at=now() WHERE id='${worker}'; SET ROLE authenticated;`)
    p=await progress(true); assert.equal(p.staff[1]?.invitation || p.staff[0].invitation,'accepted'); assert.equal(p.staff_ready,false,'accepted account still needs PIN')
    await db.exec(`RESET ROLE; UPDATE public.users SET pin_hash='synthetic',pin_reset_required=false WHERE id='${worker}'; SET ROLE authenticated;`)
    assert.equal((await progress()).staff_ready,true,'no care groups or branches required by scheduling')
    await db.exec(`RESET ROLE; INSERT INTO public.organization_locations(id,organization_id,name) VALUES('${branch}','${org}','Synthetic branch');
      INSERT INTO public.session_types(organization_id,name,code) VALUES('${org}','Synthetic type','synthetic');
      INSERT INTO public.clients(id,organization_id,first_name,status) VALUES('${client}','${org}','Synthetic','active');
      INSERT INTO public.sessions(organization_id,client_id,provider_id,scheduled_start,scheduled_end,status) VALUES('${org}','${client}','${worker}',now()+interval '1 hour',now()+interval '2 hours','confirmed'); SET ROLE authenticated;`)
    p=await progress(); for(const key of ['branch','client','session_type','staff_ready','scheduled'])assert.equal(p[key],true,key)
    assert.equal(p.care,false,'optional care absent in otherwise ready business')
    await db.exec(`RESET ROLE; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${worker}'; SET ROLE authenticated;`)
    assert.equal((await progress()).staff_ready,false,'banned accounts are not ready')
    await db.exec(`RESET ROLE; UPDATE public.users SET role='manager' WHERE id='${actor}'; INSERT INTO public.user_permissions(user_id,organization_id,can_manage_sessions) VALUES('${actor}','${org}',true); SET ROLE authenticated;`)
    p=await progress(); assert.equal(p.can_sessions,true); assert.equal(p.can_users,false); assert.equal(p.can_clients,false)
    await assert.rejects(progress(true),{code:'42501'},'restricted managers cannot access account summaries')
    await db.exec(`RESET ROLE; UPDATE public.user_permissions SET can_manage_sessions=false WHERE user_id='${actor}'; SET ROLE authenticated;`)
    p=await progress(); assert.equal(p.can_sessions,false,'read-only member can see needs-administrator steps')
    await db.exec(`RESET ROLE; INSERT INTO auth.users(id,email) VALUES('${other}','other@example.invalid'); INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required) VALUES('${other}','${other}','owner','active','synthetic',false); INSERT INTO auth.sessions(id,user_id) VALUES('${branch}','${other}'); INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${branch}','${other}',now(),now(),now()+interval '1 hour'); SELECT set_config('request.jwt.claim.sub','${other}',false); SELECT set_config('request.jwt.claims','${JSON.stringify({sub:other,session_id:branch,role:"authenticated"})}',false); SET ROLE authenticated;`)
    p=await progress(); for(const key of ['branch','client','care','session_type','staff_ready','scheduled'])assert.equal(p[key],false,'foreign '+key)
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false); SELECT set_config('request.jwt.claims','${JSON.stringify({sub:actor,session_id:sid,role:"authenticated"})}',false); UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id='${sid}'; SET ROLE authenticated;`)
    await assert.rejects(progress(),{code:'42501'})
    await db.exec(`RESET ROLE; UPDATE public.device_sessions SET unlocked_until=now()+interval '1 hour',revoked=true WHERE session_id='${sid}'; SET ROLE authenticated;`)
    await assert.rejects(progress(),{code:'42501'})
    await db.exec('RESET ROLE; SET ROLE anon'); await assert.rejects(progress(),{code:'42501'})
  } finally { await db.close() }
})



