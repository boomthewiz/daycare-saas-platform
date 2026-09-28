const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')

test('billing migration enforces roles, tenant ownership, provider count, fencing and monotonic entitlement in PostgreSQL', async () => {
  const db = new PGlite()
  try {
    // Minimal pre-existing schema, not a substitute for full Supabase acceptance.
    await db.exec(`
      SET timezone='UTC'; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE SCHEMA rejoyce_security;
      CREATE TABLE public.users(id uuid PRIMARY KEY,organization_id uuid,role text,status text);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
      CREATE TABLE public.device_sessions(session_id uuid,user_id uuid,revoked boolean DEFAULT false,unlocked_until timestamptz);
      CREATE TABLE rejoyce_security.organization_subscriptions(organization_id uuid PRIMARY KEY,trial_ends_at timestamptz,
        paid_through timestamptz,stripe_customer_id text,stripe_subscription_id text,provider_seats integer);
      INSERT INTO public.users VALUES
       ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','active'),
       ('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner','active'),
       ('00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','teacher','active'),
       ('00000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','admin','active'),
       ('00000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','teacher','inactive'),
       ('00000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','therapist','pending');
      INSERT INTO auth.sessions VALUES
       ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',null),
       ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',null),
       ('20000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004',null);
      INSERT INTO public.device_sessions SELECT id,user_id,false,now()+interval '1 hour' FROM auth.sessions;
      INSERT INTO rejoyce_security.organization_subscriptions(organization_id,trial_ends_at)
       VALUES('10000000-0000-4000-8000-000000000001',now()+interval '30 days');
    `)
    const name = fs.readdirSync(path.join(__dirname, '../supabase/migrations')).find(n => n.endsWith('_stripe_billing.sql'))
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8'))
    const query = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value
    const owner = '00000000-0000-4000-8000-000000000001', org = '10000000-0000-4000-8000-000000000001'
    const session = '20000000-0000-4000-8000-000000000001'
    const context = await query('select public.billing_owner_context($1,$2) value', [owner, session])
    assert.equal(context.provider_count, 1); assert.equal(context.organization_id, org)
    await assert.rejects(query('select public.billing_owner_context($1,$2) value', [owner, '20000000-0000-4000-8000-000000000002']), /Unlock/)
    await assert.rejects(query("select public.billing_owner_context('00000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004') value"), /owner/)
    assert.deepEqual(await query("select public.billing_owner_context('00000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002') value"), { managed: false })
    assert.equal(await query('select count(*)::integer value from rejoyce_security.billing_state'), 1)
    const lease = await query('select public.billing_lock($1,null) value', [org])
    await assert.rejects(query('select public.billing_lock($1,null) value', [org]), /busy/)
    await assert.rejects(query('select public.billing_save($1,$2,$3) value', [org, owner, '{}']), /lease expired/)
    const patch = { customer_id: 'cus_own', subscription_id: 'sub_own', paid_through: '2027-01-01T00:00:00Z' }
    await query('select public.billing_save($1,$2,$3) value', [org, lease.lease, JSON.stringify(patch)])
    await query('select public.billing_save($1,$2,$3,true) value', [org, lease.lease, JSON.stringify({ paid_through: '2026-12-01T00:00:00Z' })])
    assert.equal(await query('select paid_through::text value from rejoyce_security.organization_subscriptions where organization_id=$1', [org]), '2027-01-01 00:00:00+00')
    await assert.rejects(query('select public.billing_save($1,$2,$3) value', [org, lease.lease, '{}']), /lease expired/)
    assert.equal(await query("select public.billing_lock(null,'cus_foreign') value"), null)
    await db.exec("UPDATE public.users SET status='active' WHERE id='00000000-0000-4000-8000-000000000005'")
    const changed = await query('select public.billing_owner_context($1,$2) value', [owner, session])
    assert.equal(changed.provider_count, 2); assert.ok(changed.desired_revision > context.desired_revision)
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await query(`select has_function_privilege('${role}','public.billing_lock(uuid,text)','EXECUTE') value`), false)
      assert.equal(await query(`select has_function_privilege('${role}','public.billing_save(uuid,uuid,jsonb,boolean)','EXECUTE') value`), false)
      assert.equal(await query(`select has_function_privilege('${role}','public.billing_owner_context(uuid,uuid)','EXECUTE') value`), false)
      assert.equal(await query(`select has_table_privilege('${role}','rejoyce_security.billing_state','UPDATE') value`), false)
    }
    assert.equal(await query("select relrowsecurity value from pg_class where oid='rejoyce_security.billing_state'::regclass"), true)
  } finally { await db.close() }
})
