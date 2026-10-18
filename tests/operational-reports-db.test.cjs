/* eslint-disable @typescript-eslint/no-require-imports -- Offline PostgreSQL integration tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { loadCareDatabase, applyCareMigration } = require('./helpers/care-db.cjs')
test('operational reports enforce source authority, device/tenant boundaries, DST, corrections and pagination', {
  skip: !process.env.REJOYCE_BASELINE_SQL || !process.env.REJOYCE_PGLITE_MODULE,
}, async () => {
  const db = await loadCareDatabase()
  const migration = async name => db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8'))
  const org='11111111-1111-4111-8111-111111111111', foreign='22222222-2222-4222-8222-222222222222'
  const actor='33333333-3333-4333-8333-333333333333', sid='44444444-4444-4444-8444-444444444444'
  const child='55555555-5555-4555-8555-555555555555', north='66666666-6666-4666-8666-666666666666', south='77777777-7777-4777-8777-777777777777'
  const foreignBranch='88888888-8888-4888-8888-888888888888'
  const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].value
  const caps=()=>value('SELECT public.effective_capabilities() value')
  const report=(id,from=null,to=null,branch=null,status=null,search='',page=0)=>value('SELECT public.operational_report($1,$2,$3,$4,$5,$6,$7) value',[id,from,to,branch,status,search,page])
  try {
    await applyCareMigration(db)
    await db.exec('ALTER TABLE auth.users ADD COLUMN invited_at timestamptz, ADD COLUMN email_confirmed_at timestamptz, ADD COLUMN banned_until timestamptz;')
    await migration('20261008061322_onboarding_progress.sql')
    await migration('20261017192817_daycare_operational_reports.sql')
    await migration('20261017192818_correct_canceled_onboarding_milestone.sql')
    await db.exec(`INSERT INTO public.organizations(id,name) VALUES('${org}','Synthetic reports'),('${foreign}','Foreign');
      INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','synthetic@example.invalid',now());
      INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required,full_name) VALUES('${actor}','${org}','owner','active','synthetic',false,'Owner');
      INSERT INTO auth.sessions(id,user_id) VALUES('${sid}','${actor}');
      INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${sid}','${actor}',now(),now(),now()+interval '1 hour');
      INSERT INTO public.organization_locations(id,organization_id,name) VALUES('${north}','${org}','North'),('${south}','${org}','South'),('${foreignBranch}','${foreign}','Foreign');
      INSERT INTO public.clients(id,organization_id,first_name,status) VALUES('${child}','${org}','=Synthetic child','active');
      INSERT INTO public.clients(organization_id,first_name,status) VALUES('${foreign}','Foreign child','active');
      INSERT INTO public.client_locations(organization_id,client_id,location_id) VALUES('${org}','${child}','${north}'),('${org}','${child}','${south}');
      INSERT INTO public.sessions(organization_id,client_id,provider_id,status,scheduled_start,scheduled_end) VALUES
      ('${org}','${child}','${actor}','canceled','2026-03-08T06:00:00Z','2026-03-08T07:00:00Z');
      SELECT set_config('request.jwt.claim.sub','${actor}',false);
      SELECT set_config('request.jwt.claims','${JSON.stringify({sub:actor,session_id:sid,role:'authenticated'})}',false); SET ROLE authenticated;`)
    assert.equal((await caps()).reportingTimezone,null)
    assert.equal((await value('SELECT public.onboarding_progress() value')).scheduled,false,'canceled alone cannot complete milestone')
    assert.equal((await report('D1')).rows.length,1,'foreign child excluded')
    assert.equal((await report('D1',null,null,north)).rows.length,1,'multi-branch membership does not duplicate')
    await assert.rejects(report('D1',null,null,foreignBranch),{code:'42501'})
    await assert.rejects(report('D3','2026-03-08','2026-03-08'),{code:'22023'})
    await assert.rejects(value("SELECT public.set_reporting_timezone('Invalid/Zone') value"),{code:'22023'})
    await value("SELECT public.set_reporting_timezone('America/Chicago') value")
    const staff=(await report('D2')).rows[0]
    assert.equal(staff.pin_ready,true); assert.equal(staff.account_ready,true); assert.equal(staff.status,'active')
    assert.equal(staff.invitation,'accepted'); assert.equal(staff.pin_hash,undefined); assert.equal(staff.email,undefined)
    await assert.rejects(value('SELECT count(*) value FROM rejoyce_security.reporting_settings'),{code:'42501'},'private settings cannot be read directly')
    await db.exec(`RESET ROLE; INSERT INTO auth.users(id,email,invited_at) VALUES('${foreignBranch}','pending@example.invalid',now());
      INSERT INTO public.users(id,organization_id,full_name,role,status,pin_hash,pin_reset_required) VALUES('${foreignBranch}','${org}','Pending staff','teacher','invited',NULL,true); SET ROLE authenticated;`)
    let pending=(await report('D2')).rows.find(row=>row.name==='Pending staff')
    assert.equal(pending.invitation,'pending'); assert.equal(pending.pin_ready,false); assert.equal(pending.account_ready,false); assert.equal(pending.status,'invited')
    await db.exec(`RESET ROLE; UPDATE auth.users SET email_confirmed_at=now() WHERE id='${foreignBranch}'; SET ROLE authenticated;`)
    pending=(await report('D2')).rows.find(row=>row.name==='Pending staff')
    assert.equal(pending.invitation,'accepted'); assert.equal(pending.pin_ready,false); assert.equal(pending.account_ready,false,'acceptance alone is insufficient')
    await db.exec(`RESET ROLE; INSERT INTO public.sessions(organization_id,client_id,provider_id,status,scheduled_start,scheduled_end) VALUES
      ('${org}','${child}','${actor}','scheduled','2026-03-09T04:59:59Z','2026-03-09T05:30:00Z'),
      ('${org}','${child}','${actor}','scheduled','2026-03-09T05:00:00Z','2026-03-09T06:00:00Z'),
      ('${org}','${child}','${actor}','scheduled','2026-11-01T05:00:00Z','2026-11-01T06:00:00Z'),
      ('${org}','${child}','${actor}','scheduled','2026-11-02T05:59:59Z','2026-11-02T06:30:00Z'),
      ('${org}','${child}','${actor}','scheduled','2026-11-02T06:00:00Z','2026-11-02T07:00:00Z'); SET ROLE authenticated;`)
    assert.equal((await report('D3','2026-03-08','2026-03-08')).rows.length,2,'23-hour DST day uses exclusive next midnight')
    assert.equal((await report('D3','2026-11-01','2026-11-01')).rows.length,2,'25-hour DST day uses exclusive next midnight')
    await assert.rejects(report('D1','2026-03-08','2026-03-09'),{code:'22023'})
    await assert.rejects(report('D3','2026-03-09','2026-03-08'),{code:'22023'})
    await assert.rejects(report('D3','2020-01-01','2026-03-08'),{code:'22023'})
    await assert.rejects(report('R7'),{code:'22023'})
    await assert.rejects(report('D1',null,null,null,null,'',-1),{code:'22023'})
    await db.exec(`RESET ROLE; INSERT INTO public.clients(organization_id,first_name,status) SELECT '${org}','Page '||n,'active' FROM generate_series(1,105) n; SET ROLE authenticated;`)
    const first=await report('D1'),second=await report('D1',null,null,null,null,'',1)
    assert.equal(first.rows.length,100); assert.equal(first.hasMore,true); assert.equal(second.rows.length,6); assert.equal(second.hasMore,false)
    assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,106)
    assert.equal((await report('D1',null,null,null,null,'=Synthetic')).rows.length,1)
    await db.exec(`RESET ROLE; UPDATE public.users SET role='manager' WHERE id='${actor}';
      INSERT INTO public.user_permissions(user_id,organization_id,can_view_reports) VALUES('${actor}','${org}',true); SET ROLE authenticated;`)
    assert.equal((await caps()).reports,true); assert.equal((await caps()).users,false)
    for(const id of ['D1','D2','D3']) await assert.rejects(report(id),{code:'42501'})
    await assert.rejects(value("SELECT public.set_reporting_timezone('UTC') value"),{code:'42501'})
    await db.exec(`RESET ROLE; UPDATE public.user_permissions SET can_manage_sessions=true WHERE user_id='${actor}'; SET ROLE authenticated;`)
    assert.equal((await report('D1')).rows.length,100,'session managers already have roster source reads')
    await assert.rejects(report('D2'),{code:'42501'})
    await db.exec(`RESET ROLE; UPDATE public.user_permissions SET can_view_reports=false WHERE user_id='${actor}'; SET ROLE authenticated;`)
    await assert.rejects(report('D1'),{code:'42501'},'source authority alone is insufficient')
    await db.exec(`RESET ROLE; UPDATE public.users SET role='owner' WHERE id='${actor}';
      INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${org}','${actor}',now()-interval '40 days',now()-interval '1 day','{}'); SET ROLE authenticated;`)
    assert.equal((await caps()).canWrite,false); assert.equal((await report('D1')).rows.length,100,'existing read-only subscription access preserved')
    await assert.rejects(value("SELECT public.set_reporting_timezone('UTC') value"),{code:'42501'})
    await db.exec(`RESET ROLE; UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id='${sid}'; SET ROLE authenticated;`)
    await assert.rejects(report('D1'),{code:'42501'}); await assert.rejects(caps(),{code:'42501'})
    await db.exec(`RESET ROLE; UPDATE public.device_sessions SET unlocked_until=now()+interval '1 hour',revoked=true WHERE session_id='${sid}'; SET ROLE authenticated;`)
    await assert.rejects(report('D1'),{code:'42501'})
    await db.exec('RESET ROLE; SET ROLE anon'); await assert.rejects(report('D1'),{code:'42501'})
    await assert.rejects(caps(),{code:'42501'})
    await db.exec('RESET ROLE')
    assert.equal(await value("SELECT prosecdef value FROM pg_proc WHERE oid='public.operational_report(text,date,date,uuid,text,text,integer)'::regprocedure"),false,'source queries retain invoker RLS')
    assert.equal(await value("SELECT relrowsecurity value FROM pg_class WHERE oid='rejoyce_security.reporting_settings'::regclass"),true)
    assert.equal(await value("SELECT count(*)::integer value FROM rejoyce_security.reporting_timezone_history WHERE organization_id=$1",[org]),1,'explicit timezone change is attributed in history')
  } finally { await db.close() }
})
