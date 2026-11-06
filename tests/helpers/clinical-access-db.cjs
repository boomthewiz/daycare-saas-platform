/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic PostgreSQL. */
const fs=require('node:fs'),path=require('node:path')
const {createFoundationsDatabase,ids,actor}=require('./daycare-foundations-db.cjs')
async function createClinicalDatabase(){
 const db=await createFoundationsDatabase();await db.exec('RESET ROLE;ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean DEFAULT false')
 for(const file of ['20261025012613_scheduling_timezone.sql','20261025020957_conflict_write_coverage.sql','20261105235840_launch_foundation.sql','20261106003941_billing_recovery_grace.sql','20261106020548_billing_recovery_review.sql','20261106055633_clinical_access_coverage.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',file),'utf8').replace(/\r\n/g,'\n'))
 await actor(db);await db.query("SELECT public.set_scheduling_timezone($1,'UTC',0)",[ids.org]);return db
}
async function approve(db,user=ids.owner){
 await db.exec(`RESET ROLE; INSERT INTO rejoyce_security.clinical_modules VALUES('${ids.org}',true,1) ON CONFLICT(organization_id) DO UPDATE SET enabled=true;
 INSERT INTO rejoyce_security.clinical_program_grants VALUES('${ids.org}','${user}',true,false,1) ON CONFLICT(organization_id,user_id) DO UPDATE SET program_read=true;`)
 await actor(db,user,user===ids.owner?ids.device:ids.staffDevice)
}
module.exports={createClinicalDatabase,approve,ids,actor}
