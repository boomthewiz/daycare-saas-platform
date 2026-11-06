/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic database authority and recovery checks. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
async function database(){
 const db=await createFoundationsDatabase();await db.exec('RESET ROLE')
 for(const name of ['20261105235840_launch_foundation.sql','20261106003941_billing_recovery_grace.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8').replace(/\r\n/g,'\n'))
 await db.exec(`INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '40 days',now()-interval '10 days','{}');UPDATE auth.sessions SET aal='aal2';`)
 await actor(db);return db
}
async function support(db,{method='totp',ago=0,version=1}={}){
 await actor(db);await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.owner,session_id:ids.device,role:'authenticated',aal:'aal2',amr:[{method,timestamp:Math.floor(Date.now()/1000)-ago}]})]);return version
}
async function enroll(db,role='billing'){
 await db.exec(`RESET ROLE;INSERT INTO rejoyce_security.support_workforce VALUES('${ids.owner}','${role}',true,1);INSERT INTO rejoyce_security.billing_grace_policies VALUES(1,true,3600,1,300,false,'${ids.owner}','POLICY-1',now());`);await support(db)
}
function command(db,overrides={}){
 const p={action:'grant',org:ids.org,grace:null,version:0,policy:1,expires:new Date(Date.now()+1800000).toISOString(),ticket:'CASE-123',reason:'payment_recovery',operation:randomUUID(),workforce:1,...overrides}
 return {p,run:async()=>(await db.query('SELECT public.support_billing_grace($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v',[p.action,p.org,p.grace,p.version,p.policy,p.expires,p.ticket,p.reason,p.operation,p.workforce])).rows[0].v}
}
const access=async db=>(await db.query('SELECT public.subscription_access() v')).rows[0].v
const inspect=async(db,sql)=>{await db.exec('RESET ROLE');const result=await db.exec(sql);await support(db);return result.at(-1)?.rows||[]}
test('grace requires approved policy, distinct workforce action and fresh TOTP; customer roles and agents deny',async()=>{
 const db=await database();try{
  assert.equal((await access(db)).canWrite,false)
  await assert.rejects(command(db).run(),/authority/)
  await enroll(db,'agent');await assert.rejects(command(db).run(),/authority/)
  await inspect(db,"UPDATE rejoyce_security.support_workforce SET role='billing'")
  await support(db,{method:'token_refresh'});await assert.rejects(command(db).run(),/MFA/)
  await support(db,{ago:600});await assert.rejects(command(db).run(),/MFA/)
  await support(db);await assert.rejects(command(db,{workforce:0}).run(),/authority/)
  await assert.rejects(command(db,{policy:2}).run(),/policy/)
  await assert.rejects(command(db,{expires:new Date(Date.now()+7200000).toISOString()}).run(),/Expiry/)
  await assert.rejects(command(db,{org:ids.foreignOrg}).run(),/Managed/)
  await assert.rejects(command(db,{ticket:'child narrative here'}).run(),/Review/)
  await inspect(db,'UPDATE rejoyce_security.billing_grace_policies SET active=false');await assert.rejects(command(db).run(),/policy/)
 }finally{await db.close()}
})
test('grant/replay/revoke are atomic and versioned, with truthful payment history and unchanged clinical/device denials',async()=>{
 const db=await database();try{
  await enroll(db)
  const before=await inspect(db,'SELECT to_jsonb(b) v FROM rejoyce_security.organization_subscriptions b')
  const c=command(db),first=await c.run();assert.equal(first.version,1);assert.deepEqual(await c.run(),first)
  const current=await access(db);assert.equal(current.canWrite,true);assert.equal(current.paidThrough,null);assert.equal(current.supportGraceExpiresAt,first.expiresAt)
  assert.equal((await db.query('SELECT * FROM public.client_behaviors')).rows.length,0,'grace never enables clinical program')
  await assert.rejects(command(db,{version:0}).run(),/changed/)
  await assert.rejects(command(db,{version:1,operation:c.p.operation}).run(),/different/)
  await inspect(db,`UPDATE rejoyce_security.support_workforce SET active=false,version=2`)
  await assert.rejects(c.run(),/authority/,'receipt replay still requires live authority')
  await inspect(db,`UPDATE rejoyce_security.support_workforce SET active=true,version=1`)
  const revoke=command(db,{action:'revoke',grace:first.graceId,version:1,expires:null});assert.equal((await revoke.run()).version,2)
  assert.equal((await access(db)).canWrite,false);assert.deepEqual(await revoke.run(),await revoke.run())
  assert.deepEqual(await inspect(db,'SELECT to_jsonb(b) v FROM rejoyce_security.organization_subscriptions b'),before)
  assert.equal((await inspect(db,'SELECT count(*)::int n FROM rejoyce_security.billing_grace_audit'))[0].n,2)
  await inspect(db,`UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}'`)
  await assert.rejects(command(db,{version:2}).run(),/unlock|sign-in/)
 }finally{await db.close()}
})
test('expiry is enforced without cleanup; policy deactivation and renewal caps cannot become permanent overrides',async()=>{
 const db=await database();try{
  await enroll(db);await command(db).run()
  await inspect(db,"UPDATE rejoyce_security.billing_graces SET starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'")
  assert.equal((await access(db)).canWrite,false);assert.equal((await access(db)).supportGraceExpiresAt,null)
  const second=await command(db,{version:1}).run();assert.equal((await access(db)).canWrite,true)
  await command(db,{action:'revoke',grace:second.graceId,version:2,expires:null}).run()
  await assert.rejects(command(db,{version:3}).run(),/renewal limit/)
  await inspect(db,'UPDATE rejoyce_security.billing_grace_policies SET active=false');assert.equal((await access(db)).canWrite,false)
 }finally{await db.close()}
})
test('audit failure rolls back grants, versions and receipts; private tables and old resolver are inaccessible',async()=>{
 const db=await database();try{
  await enroll(db)
  await inspect(db,"CREATE FUNCTION rejoyce_security.fail_grace_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure';END $$;CREATE TRIGGER fail_grace_audit BEFORE INSERT ON rejoyce_security.billing_grace_audit FOR EACH ROW EXECUTE FUNCTION rejoyce_security.fail_grace_audit();")
  await assert.rejects(command(db).run(),/Synthetic audit failure/)
  for(const name of ['billing_graces','billing_grace_state','billing_grace_operations','billing_grace_audit'])assert.equal((await inspect(db,`SELECT count(*)::int n FROM rejoyce_security.${name}`))[0].n,0)
  for(const name of ['billing_grace_policies','billing_graces','billing_grace_state','billing_grace_operations','billing_grace_audit'])await assert.rejects(db.query(`SELECT * FROM rejoyce_security.${name}`),/permission denied/)
  await assert.rejects(db.query('SELECT rejoyce_security.subscription_access_before_grace(NULL)'),/permission denied/)
  await db.exec('RESET ROLE');await assert.rejects(db.query('TRUNCATE rejoyce_security.billing_grace_audit'),/append-only/)
  await assert.rejects(db.query('UPDATE rejoyce_security.billing_grace_policies SET max_duration_seconds=999999'),/immutable/)
 }finally{await db.close()}
})
test('policy requiring independent approval fails closed; grace never changes unmanaged compatibility',async()=>{
 const db=await database();try{
  await enroll(db,'administrator')
  await inspect(db,`UPDATE rejoyce_security.billing_grace_policies SET active=false;INSERT INTO rejoyce_security.billing_grace_policies VALUES(2,true,3600,0,300,true,'${ids.owner}','POLICY-2',now())`)
  await assert.rejects(command(db,{policy:2}).run(),/Independent approval/)
  await inspect(db,`DELETE FROM rejoyce_security.organization_subscriptions WHERE organization_id='${ids.org}'`)
  assert.equal((await access(db)).managed,false);assert.equal((await access(db)).canWrite,true)
  await assert.rejects(command(db,{policy:2}).run(),/Managed/)
 }finally{await db.close()}
})
