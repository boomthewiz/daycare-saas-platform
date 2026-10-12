/* eslint-disable @typescript-eslint/no-require-imports -- Shared Node CommonJS test fixture. */
const fs = require('node:fs')
const path = require('node:path')
const { loadCareDatabase, applyCareMigration } = require('./helpers/care-db.cjs')
const ids = {
  org: '10000000-0000-4000-8000-000000000001', foreignOrg: '10000000-0000-4000-8000-000000000002',
  owner: '20000000-0000-4000-8000-000000000001', staff: '20000000-0000-4000-8000-000000000002',
  device: '30000000-0000-4000-8000-000000000001', staffDevice: '30000000-0000-4000-8000-000000000002',
  client: '40000000-0000-4000-8000-000000000001', sourceClient: '40000000-0000-4000-8000-000000000002', foreignClient: '40000000-0000-4000-8000-000000000003',
  source: '50000000-0000-4000-8000-000000000001', foreignSource: '50000000-0000-4000-8000-000000000002',
  session: '60000000-0000-4000-8000-000000000001',
}
async function actor(db, user = ids.owner, device = ids.device) {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({sub:user,session_id:device,role:'authenticated'})])
  await db.exec('SET ROLE authenticated')
}
async function createDatabase() {
  const db = await loadCareDatabase()
  await applyCareMigration(db)
  const dir = path.join(__dirname, '../supabase/migrations')
  await db.exec(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(file => file.endsWith('_reusable_client_behaviors.sql'))), 'utf8'))
  await db.exec(`INSERT INTO public.organizations(id,name) VALUES('${ids.org}','Synthetic A'),('${ids.foreignOrg}','Synthetic B');
    INSERT INTO auth.users(id,email) VALUES('${ids.owner}','owner@example.invalid'),('${ids.staff}','staff@example.invalid');
    INSERT INTO public.users(id,organization_id,email,full_name,role,status,pin_hash,pin_reset_required) VALUES
      ('${ids.owner}','${ids.org}','owner@example.invalid','Synthetic owner','owner','active','synthetic',false),
      ('${ids.staff}','${ids.org}','staff@example.invalid','Synthetic staff','teacher','active','synthetic',false);
    INSERT INTO auth.sessions(id,user_id) VALUES('${ids.device}','${ids.owner}'),('${ids.staffDevice}','${ids.staff}');
    INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
      SELECT id,user_id,now(),now(),now()+interval '1 day' FROM auth.sessions;
    INSERT INTO public.clients(id,organization_id,first_name) VALUES
      ('${ids.client}','${ids.org}','Synthetic destination'),('${ids.sourceClient}','${ids.org}','Synthetic source'),('${ids.foreignClient}','${ids.foreignOrg}','Foreign client');
    INSERT INTO public.client_behaviors(id,organization_id,client_id,name,description,measurement_type) VALUES
      ('${ids.source}','${ids.org}','${ids.sourceClient}','Elopement','Synthetic guidance','frequency'),
      ('${ids.foreignSource}','${ids.foreignOrg}','${ids.foreignClient}','Foreign behavior',NULL,'frequency');
    INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES('${ids.org}','Direct service','direct_therapy',60);
    INSERT INTO public.sessions(id,organization_id,client_id,provider_id,session_type,scheduled_start,scheduled_end,status)
      VALUES('${ids.session}','${ids.org}','${ids.client}','${ids.staff}','direct_therapy',now(),now()+interval '1 hour','scheduled');`)
  await actor(db)
  return db
}
module.exports = { createDatabase, actor, ids }
