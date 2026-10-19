require('./setup.cjs')
/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createDatabase, actor, ids } = require('./client-program.fixture.cjs')
const options = require('./helpers/load-ts.cjs')('lib/client-program-options.ts')

test('behavior dropdown isolates organizations and deduplicates reusable definitions', () => {
  const row = {id:'a',organization_id:'org',client_id:'source',name:' Elopement ',measurement_type:'frequency',description:'Guidance',active:true}
  const local = {...row,id:'b',client_id:'client',name:'elopement',active:false}
  assert.deepEqual(options.reusableBehaviors([row,local,{...row,id:'c',organization_id:'foreign'}], 'org', 'client'), [local])
  assert.equal(options.reusableBehaviors([{...row,active:false}], 'org', 'client').length, 0)
  assert.equal(options.reusableBehaviors([row,{...row,id:'d',measurement_type:'duration'}], 'org', 'client').length, 2)
})

test('production-compatible targets, reusable assignment and session use preserve database boundaries', {
  skip: false,
}, async () => {
  const db = await createDatabase()
  const apply = async (client = ids.client, source = ids.source) => (await db.query('SELECT public.apply_client_behavior($1,$2) id', [client,source])).rows[0].id
  try {
    const first = await apply()
    assert.equal(await apply(), first, 'Retry must reuse the same assignment')
    assert.equal((await db.query('SELECT count(*)::int n FROM public.client_behaviors WHERE client_id=$1',[ids.client])).rows[0].n, 1)
    await db.query("UPDATE public.client_behaviors SET active=false,description='Individualized' WHERE id=$1",[first])
    assert.equal(await apply(),first)
    assert.deepEqual((await db.query('SELECT active,description FROM public.client_behaviors WHERE id=$1',[first])).rows[0],{active:true,description:'Individualized'})
    await assert.rejects(apply(ids.foreignClient), /Client is unavailable/)
    await assert.rejects(apply(ids.client,ids.foreignSource), /Behavior is unavailable/)
    await assert.rejects(apply(ids.client,'50000000-0000-4000-8000-000000000099'), /Behavior is unavailable/)
    // Every offered type/mode combination passes the unchanged database CHECKs.
    for (const type of options.TARGET_TYPES) for (const mode of options.RESPONSE_MODES) {
      await db.query('INSERT INTO public.client_targets(organization_id,client_id,title,target_type,response_mode) VALUES($1,$2,$3,$4,$5)',[ids.org,ids.client,`${type.value}/${mode.value}`,type.value,mode.value])
    }
    for (const invalid of ['independent_prompted','rating']) {
      await assert.rejects(db.query('INSERT INTO public.client_targets(organization_id,client_id,title,response_mode) VALUES($1,$2,$3,$4)',[ids.org,ids.client,'Invalid',invalid]), /response_mode_check/)
    }
    await db.query('SELECT public.prepare_session_targets($1)',[ids.session])
    assert.equal((await db.query('SELECT count(*)::int n FROM public.session_targets WHERE session_id=$1',[ids.session])).rows[0].n,35)
    assert.equal((await db.query('SELECT count(*)::int n FROM public.session_targets st JOIN public.client_targets ct ON st.client_target_id=ct.id WHERE st.response_mode<>ct.response_mode')).rows[0].n,0)
    await db.query('SELECT public.prepare_session_targets($1)',[ids.session])
    assert.equal((await db.query('SELECT count(*)::int n FROM public.session_targets WHERE session_id=$1',[ids.session])).rows[0].n,35)
    await actor(db,ids.staff,ids.staffDevice)
    assert.equal((await db.query('SELECT count(*)::int n FROM public.client_behaviors WHERE client_id=$1 AND active',[ids.client])).rows[0].n,1,'Assigned session provider sees applied behavior')
    await assert.rejects(apply(), /permission is required/)
    await db.query('SELECT public.start_assigned_session($1)',[ids.session])
    await db.query('SELECT public.record_behavior_event($1,$2)',[ids.session,first])
    assert.equal((await db.query('SELECT count(*)::int n FROM public.behavior_events WHERE session_id=$1',[ids.session])).rows[0].n,1)
    await actor(db)
    await db.exec('RESET ROLE')
    await db.query('UPDATE public.device_sessions SET revoked=true WHERE session_id=$1',[ids.device])
    await db.exec('SET ROLE authenticated')
    await assert.rejects(apply(), /permission|unavailable/)
    await db.exec('RESET ROLE')
    await db.query('UPDATE public.device_sessions SET revoked=false,unlocked_until=now()-interval \'1 second\' WHERE session_id=$1',[ids.device])
    await db.exec('SET ROLE authenticated')
    await assert.rejects(apply(), /permission|unavailable/)
    await db.exec('RESET ROLE')
    await db.query('UPDATE public.device_sessions SET unlocked_until=now()+interval \'1 day\' WHERE session_id=$1',[ids.device])
    await db.query("INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES($1,$2,now()-interval '30 days',now()-interval '1 day','{}')",[ids.org,ids.owner])
    await db.query('UPDATE public.client_behaviors SET active=false WHERE id=$1',[first])
    await db.exec('SET ROLE authenticated')
    await assert.rejects(apply(), /trial has ended/)
    await assert.rejects(db.query('INSERT INTO public.client_targets(organization_id,client_id,title) VALUES($1,$2,$3)',[ids.org,ids.client,'Read-only']), /trial has ended/)
    await db.exec('RESET ROLE')
    assert.equal((await db.query("SELECT has_function_privilege('anon','public.apply_client_behavior(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false)
  } finally { await db.close() }
})
