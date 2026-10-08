/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline PostgreSQL test harness. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { loadCareDatabase, applyCareMigration } = require('./helpers/care-db.cjs')
test('imports are atomic, repeat-safe and retain grants, business, device and subscription boundaries', {
  skip: !process.env.REJOYCE_BASELINE_SQL || !process.env.REJOYCE_PGLITE_MODULE,
}, async () => {
  const db=await loadCareDatabase()
  try {
    await applyCareMigration(db)
    const dir=path.join(__dirname,'../supabase/migrations')
    await db.exec(fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(file=>file.endsWith('_portal_enhancements.sql'))),'utf8'))
    const org='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
    const actor='33333333-3333-4333-8333-333333333333', sid='44444444-4444-4444-8444-444444444444'
    const branch='55555555-5555-4555-8555-555555555555', foreign='66666666-6666-4666-8666-666666666666'
    await db.exec(`INSERT INTO public.organizations(id,name) VALUES('${org}','Synthetic import'),('${other}','Other business');
      INSERT INTO auth.users(id,email) VALUES('${actor}','import@example.invalid');
      INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required) VALUES('${actor}','${org}','manager','active','synthetic',false);
      INSERT INTO auth.sessions(id,user_id) VALUES('${sid}','${actor}');
      INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${sid}','${actor}',now(),now(),now()+interval '1 hour');
      INSERT INTO public.user_permissions(user_id,organization_id,can_manage_clients) VALUES('${actor}','${org}',true);
      INSERT INTO public.organization_locations(id,organization_id,name) VALUES('${branch}','${org}','North'),('${foreign}','${other}','Other');
      INSERT INTO public.organization_terminology(organization_id) VALUES('${org}'),('${other}');
      SELECT set_config('request.jwt.claim.sub','${actor}',false);
      SELECT set_config('request.jwt.claims','${JSON.stringify({sub:actor,session_id:sid,role:'authenticated'})}',false); SET ROLE authenticated;`)
    const call=async(rows,location=branch)=>(await db.query('SELECT public.import_clients($1::jsonb,$2::uuid) value',[JSON.stringify(rows),location])).rows[0].value
    const sample=[{external_id:'C1',first_name:'Sam',last_name:'Example',preferred_name:'Sam'}]
    await assert.rejects(db.query('SELECT public.session_people_readiness()'),{code:'42501'})
    assert.equal((await call(sample))[0].status,'created')
    assert.equal((await call(sample))[0].status,'skipped')
    assert.equal((await db.query('SELECT count(*)::integer count FROM public.clients')).rows[0].count,1)
    assert.equal((await db.query('SELECT count(*)::integer count FROM public.client_locations')).rows[0].count,1)
    assert.equal((await db.query('SELECT count(*)::integer count FROM public.client_care_members')).rows[0].count,0)
    for(const rows of [null,{},[],[{external_id:'C2',first_name:'Jo'},{external_id:'C3',first_name:''}],[{external_id:'D',first_name:'A'},{external_id:'D',first_name:'B'}],[{external_id:'X',first_name:'A',organization_id:other}],[{external_id:'N',first_name:5}],[{external_id:'K',first_name:'A\nB'}],Array.from({length:101},(_,i)=>({external_id:String(i),first_name:'A'}))])await assert.rejects(call(rows))
    assert.equal((await db.query('SELECT count(*)::integer count FROM public.clients')).rows[0].count,1,'invalid batch rolled back')
    await assert.rejects(call([{external_id:'F',first_name:'A'}],foreign))
    await db.exec("UPDATE public.organization_terminology SET portal_theme='ocean',client_plural='Students' WHERE organization_id='"+org+"'")
    assert.equal((await db.query('SELECT portal_theme FROM public.organization_terminology')).rows[0].portal_theme,'ocean')
    await assert.rejects(db.exec("UPDATE public.organization_terminology SET portal_theme='unsupported'"),{code:'23514'})
    assert.equal((await db.query("UPDATE public.organization_terminology SET portal_theme='lavender' WHERE organization_id=$1 RETURNING organization_id",[other])).rows.length,0)
    await db.exec(`RESET ROLE; UPDATE public.user_permissions SET can_manage_clients=false WHERE user_id='${actor}'; SET ROLE authenticated;`)
    await assert.rejects(call(sample),{code:'42501'})
    assert.equal((await db.query("UPDATE public.organization_terminology SET portal_theme='lavender' RETURNING organization_id")).rows.length,0)
    await db.exec(`RESET ROLE; UPDATE public.user_permissions SET can_manage_sessions=true WHERE user_id='${actor}'; SET ROLE authenticated;`)
    assert.deepEqual((await db.query('SELECT public.session_people_readiness() value')).rows[0].value,{missing_clients:false,missing_staff:true},'restricted user list is not used for readiness; a manager does not count as frontline staff')
    assert.equal((await db.query("UPDATE public.organization_terminology SET portal_theme='lavender' RETURNING organization_id")).rows.length,1)
    await assert.rejects(call(sample),{code:'42501'},'session grant cannot import clients')
    await db.exec(`RESET ROLE; UPDATE public.user_permissions SET can_manage_clients=true WHERE user_id='${actor}'; UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id='${sid}'; SET ROLE authenticated;`)
    await assert.rejects(call(sample),{code:'42501'})
    await assert.rejects(db.query('SELECT public.session_people_readiness()'),{code:'42501'})
    assert.equal((await db.query('SELECT * FROM public.organization_terminology')).rows.length,0)
    await db.exec(`RESET ROLE; UPDATE public.device_sessions SET unlocked_until=now()+interval '1 hour',revoked=true WHERE session_id='${sid}'; SET ROLE authenticated;`)
    await assert.rejects(call(sample),{code:'42501'})
    await db.exec(`RESET ROLE; UPDATE public.device_sessions SET revoked=false WHERE session_id='${sid}'; INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${org}','${actor}',now()-interval '40 days',now()-interval '1 day','{}'); SET ROLE authenticated;`)
    await assert.rejects(call(sample),{code:'P4020'})
    await assert.rejects(db.exec("UPDATE public.organization_terminology SET portal_theme='ocean'"),{code:'P4020'})
    await db.exec('RESET ROLE; SET ROLE anon')
    await assert.rejects(call(sample),{code:'42501'})
  } finally { await db.close() }
})
