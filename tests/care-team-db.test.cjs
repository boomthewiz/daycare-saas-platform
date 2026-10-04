// Offline PostgreSQL verification. Set REJOYCE_BASELINE_SQL to a schema-only
// pre-migration snapshot and REJOYCE_PGLITE_MODULE to an installed PGlite module.
// No network connections or production writes are made by this test.
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

test('care-team migration enforces access, tenants, branches, atomicity, versions, device and subscription safeguards', {
  skip: !process.env.REJOYCE_BASELINE_SQL || !process.env.REJOYCE_PGLITE_MODULE,
}, async () => {
  const { PGlite } = require(process.env.REJOYCE_PGLITE_MODULE)
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE ROLE supabase_auth_admin; CREATE ROLE supabase_admin; CREATE ROLE authenticator;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz,created_at timestamptz DEFAULT now(),aal text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
      GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;`)
    await db.exec(fs.readFileSync(process.env.REJOYCE_BASELINE_SQL, 'utf8'))
    await db.exec(`INSERT INTO rejoyce_security.session_policy(singleton,enforced) VALUES(true,true) ON CONFLICT(singleton) DO UPDATE SET enforced=true;
      SET row_security=on;`)
    // Seed a pre-existing default-worker assignment before applying the migration.
    await db.exec(`INSERT INTO public.organizations(id,name) VALUES('10000000-0000-4000-8000-000000000001','Legacy synthetic');
      INSERT INTO public.users(id,organization_id,full_name,role,status) VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Legacy worker','teacher','active');
      INSERT INTO public.organization_locations(id,organization_id,name) VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Legacy branch');
      INSERT INTO public.clients(id,organization_id,first_name,assigned_provider_id) VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Legacy client','20000000-0000-4000-8000-000000000001');
      INSERT INTO public.client_locations VALUES('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now());`)
    const dir = path.join(__dirname, '../supabase/migrations')
    const migration = fs.readdirSync(dir).find(file => file.endsWith('_client_care_teams.sql'))
    await db.exec('BEGIN')
    await db.exec(fs.readFileSync(path.join(dir, migration), 'utf8'))
    await db.exec('COMMIT')
    assert.equal((await db.query('SELECT count(*)::int n FROM public.client_care_members')).rows[0].n, 1)
    assert.equal((await db.query('SELECT count(*)::int n FROM public.staff_locations')).rows[0].n, 1)
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/tests/client_care_teams.sql'), 'utf8'))
    assert.equal((await db.query('SELECT count(*)::int n FROM public.clients')).rows[0].n, 1)
  } finally { await db.close() }
})
