/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL fixture. */
const fs=require('node:fs'),path=require('node:path')
const {createDatabase,ids,actor}=require('../client-program.fixture.cjs')
async function createFoundationsDatabase(){
 const db=await createDatabase()
 await db.exec('RESET ROLE; ALTER TABLE auth.users ADD COLUMN invited_at timestamptz, ADD COLUMN email_confirmed_at timestamptz, ADD COLUMN banned_until timestamptz;')
 for(const file of ['20261008061322_onboarding_progress.sql','20261017192817_daycare_operational_reports.sql','20261017192818_correct_canceled_onboarding_milestone.sql','20261018084149_branch_attendance.sql','20261018084157_session_context_tags.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',file),'utf8'))
 const readiness=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261007195601_portal_enhancements.sql'),'utf8').split('-- Existing terminology')[0]
 await db.exec(readiness+'COMMIT;')
 await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261019194610_p1_activity_and_attendance_activation.sql'),'utf8'))
 ids.north='70000000-0000-4000-8000-000000000001';ids.south='70000000-0000-4000-8000-000000000002';ids.foreignBranch='70000000-0000-4000-8000-000000000003'
 await db.exec(`INSERT INTO public.organization_locations(id,organization_id,name) VALUES('${ids.north}','${ids.org}','North'),('${ids.south}','${ids.org}','South'),('${ids.foreignBranch}','${ids.foreignOrg}','Foreign');
 INSERT INTO public.client_locations(organization_id,client_id,location_id) VALUES('${ids.org}','${ids.client}','${ids.north}'),('${ids.org}','${ids.client}','${ids.south}');`)
 await actor(db);await db.query("SELECT public.set_reporting_timezone('America/Chicago')")
 return db
}
module.exports={createFoundationsDatabase,ids,actor}
