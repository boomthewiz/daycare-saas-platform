/* eslint-disable @typescript-eslint/no-require-imports -- Isolated current recovery schema and two workforce identities. */
const fs=require('node:fs'),path=require('node:path')
const {createFoundationsDatabase,ids,actor}=require('./daycare-foundations-db.cjs')
async function createRecoveryDatabase(){
 const db=await createFoundationsDatabase();await db.exec('RESET ROLE; ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean DEFAULT false')
 for(const n of ['20261025012613_scheduling_timezone.sql','20261025020957_conflict_write_coverage.sql','20261105235840_launch_foundation.sql','20261106003941_billing_recovery_grace.sql','20261106020548_billing_recovery_review.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',n),'utf8').replace(/\r\n/g,'\n'))
 await actor(db);await db.query("SELECT public.set_scheduling_timezone($1,'UTC',0)",[ids.org]);await db.exec('RESET ROLE')
 await db.exec(`INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '40 days',now()-interval '10 days','{}');UPDATE auth.sessions SET aal='aal2';
 INSERT INTO rejoyce_security.support_workforce VALUES('${ids.owner}','billing',true,1),('${ids.staff}','administrator',true,1);
 INSERT INTO rejoyce_security.billing_grace_policies VALUES(1,true,3600,1,300,true,'${ids.owner}','POLICY-1',now());`)
 await workforce(db);return db
}
async function workforce(db,user=ids.owner,version=1){
 const device=user===ids.owner?ids.device:ids.staffDevice;await actor(db,user,device)
 await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:device,role:'authenticated',aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]})]);return version
}
async function inspect(db,sql){await db.exec('RESET ROLE');const r=await db.exec(sql);await workforce(db);return r.at(-1)?.rows||[]}
async function prepare(db,overrides={}){
 const p={action:'grant',org:ids.org,grace:null,version:0,policy:1,expires:new Date(Date.now()+1800000).toISOString(),ticket:'CASE-123',reason:'payment_recovery',workforce:1,...overrides}
 return (await db.query('SELECT public.prepare_billing_grace($1,$2,$3,$4,$5,$6,$7,$8,$9) v',[p.action,p.org,p.grace,p.version,p.policy,p.expires,p.ticket,p.reason,p.workforce])).rows[0].v
}
const review=async(db,id,approve=false,version=1)=>(await db.query('SELECT public.inspect_billing_grace_review($1,$2,$3,$4) v',[id,ids.org,approve,version])).rows[0].v
const confirm=async(db,id,operation,version=1)=>(await db.query('SELECT public.confirm_billing_grace($1,$2,$3,$4) v',[id,ids.org,operation,version])).rows[0].v
module.exports={createRecoveryDatabase,workforce,inspect,prepare,review,confirm,ids}
