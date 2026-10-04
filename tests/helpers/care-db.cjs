const fs = require('node:fs')
const path = require('node:path')
async function loadCareDatabase() {
  if (!process.env.REJOYCE_BASELINE_SQL || !process.env.REJOYCE_PGLITE_MODULE) throw new Error('Set REJOYCE_BASELINE_SQL and REJOYCE_PGLITE_MODULE for offline PostgreSQL tests.')
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
    await db.exec(fs.readFileSync(process.env.REJOYCE_BASELINE_SQL,'utf8'))
    await db.exec(`INSERT INTO rejoyce_security.session_policy(singleton,enforced) VALUES(true,true) ON CONFLICT(singleton) DO UPDATE SET enforced=true; SET row_security=on;`)
    return db
  } catch (cause) { await db.close(); throw cause }
}
async function applyCareMigration(db) {
  const dir = path.join(__dirname, '../../supabase/migrations')
  const name = fs.readdirSync(dir).find(name => name.endsWith('_client_care_teams.sql'))
  await db.exec('BEGIN')
  try { await db.exec(fs.readFileSync(path.join(dir,name),'utf8')); await db.exec('COMMIT') }
  catch (cause) { await db.exec('ROLLBACK'); throw cause }
}
module.exports = { loadCareDatabase, applyCareMigration }
