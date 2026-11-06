/* eslint-disable @typescript-eslint/no-require-imports -- Current review/approval authority and transaction tests. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createRecoveryDatabase,workforce,inspect,prepare,review,confirm,ids}=require('./helpers/billing-recovery-db.cjs')
const access=async db=>(await db.query('SELECT public.subscription_access() v')).rows[0].v
test('review binds exact organization, action, expiry and version; approval cannot execute or approve its own request',async()=>{
 const db=await createRecoveryDatabase();try{
  const before=(await access(db)).paidThrough,r=await prepare(db),op=randomUUID()
  await assert.rejects(db.query('SELECT public.inspect_billing_grace_review($1,$2,false,1)',[r.id,ids.foreignOrg]),/unavailable/);await assert.rejects(db.query('SELECT public.confirm_billing_grace($1,$2,$3,1)',[r.id,ids.foreignOrg,op]),/unavailable/);
  assert.equal(r.snapshot.organizationName,'Synthetic A');assert.equal(r.snapshot.policy.requiresSecondApproval,true)
  assert.equal((await access(db)).canWrite,false,'preview never changes customer access')
  await assert.rejects(confirm(db,r.id,op),/Independent approval/)
  await assert.rejects(review(db,r.id,true),/Independent support administrator/)
  await workforce(db,ids.staff);assert.equal((await review(db,r.id)).approved,false)
  assert.equal((await review(db,r.id,true)).approved,true)
  await assert.rejects(confirm(db,r.id,op),/unavailable/,'approver cannot execute another actor review')
  await workforce(db);const result=await confirm(db,r.id,op)
  assert.equal(result.version,1);assert.deepEqual(await confirm(db,r.id,op),result)
  await assert.rejects(confirm(db,r.id,randomUUID()),/already confirmed/)
  const current=await access(db);assert.equal(current.canWrite,true);assert.equal(current.paidThrough,before)
  assert.equal(current.billingNotices.length,1);assert.equal(current.billingNotices[0].action,'grant')
  assert.deepEqual(Object.keys(current.billingNotices[0]).sort(),['action','createdAt','expiresAt','version'])
 }finally{await db.close()}
})
test('direct mutation bypass and private review/approval/notice tables deny; customers and support agents cannot obtain billing context',async()=>{
 const db=await createRecoveryDatabase();try{
  await assert.rejects(db.query("SELECT public.support_billing_grace('grant',$1,NULL,0,1,now()+interval '30 minutes','CASE-123','payment_recovery',gen_random_uuid(),1)",[ids.org]),/permission denied/)
  for(const table of ['billing_grace_reviews','billing_grace_approvals','billing_grace_review_audit','billing_grace_review_permits','billing_grace_notices'])await assert.rejects(db.query(`SELECT * FROM rejoyce_security.${table}`),/permission denied/)
  await inspect(db,`UPDATE rejoyce_security.support_workforce SET active=false WHERE user_id='${ids.owner}'`)
  await assert.rejects(db.query('SELECT public.support_billing_context($1,$2,1)',[ids.foreignOrg,'CASE-123']),/authority/)
  await inspect(db,`UPDATE rejoyce_security.support_workforce SET active=true,role='agent' WHERE user_id='${ids.owner}'`)
  await assert.rejects(prepare(db),/authority/)
 }finally{await db.close()}
})
test('expired reviews, stale state and revoked approver membership/session/device invalidate pending approval',async()=>{
 for(const change of ['membership','session','device','pin','fullAuth','anonymous','expiry','state']){
  const db=await createRecoveryDatabase();try{
   const r=await prepare(db);await workforce(db,ids.staff);await review(db,r.id,true)
   const changes={pin:`UPDATE public.users SET pin_reset_required=true WHERE id='${ids.staff}'`,fullAuth:`UPDATE public.device_sessions SET full_auth_at=now()-interval '31 days' WHERE session_id='${ids.staffDevice}'`,anonymous:`UPDATE auth.users SET is_anonymous=true WHERE id='${ids.staff}'`,membership:`UPDATE rejoyce_security.support_workforce SET active=false,version=2 WHERE user_id='${ids.staff}'`,session:`UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${ids.staffDevice}'`,device:`UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.staffDevice}'`,expiry:`UPDATE rejoyce_security.billing_grace_reviews SET valid_until=now()-interval '1 second'`,state:`INSERT INTO rejoyce_security.billing_grace_state VALUES('${ids.org}',1)`}
   await inspect(db,changes[change]);await assert.rejects(confirm(db,r.id,randomUUID()),/changed|expired/)
   assert.equal((await access(db)).canWrite,false)
  }finally{await db.close()}
 }
})
test('failed customer notice or review audit rolls back mutation, receipt, version and consumption; retry keeps one grant',async()=>{
 for(const table of ['billing_grace_notices','billing_grace_review_audit']){
  const db=await createRecoveryDatabase();try{
   const r=await prepare(db),op=randomUUID();await workforce(db,ids.staff);await review(db,r.id,true)
   await inspect(db,`CREATE FUNCTION rejoyce_security.fail_review_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic review/notice failure';END $$;CREATE TRIGGER fail_write BEFORE INSERT ON rejoyce_security.${table} FOR EACH ROW EXECUTE FUNCTION rejoyce_security.fail_review_write();`)
   await assert.rejects(confirm(db,r.id,op),/Synthetic review\/notice failure/)
   assert.equal((await inspect(db,'SELECT count(*)::int n FROM rejoyce_security.billing_graces'))[0].n,0)
   assert.equal((await inspect(db,'SELECT count(*)::int n FROM rejoyce_security.billing_grace_operations'))[0].n,0)
   assert.equal((await inspect(db,'SELECT operation_id FROM rejoyce_security.billing_grace_reviews'))[0].operation_id,null)
   await inspect(db,`DROP TRIGGER fail_write ON rejoyce_security.${table}`)
   assert.equal((await confirm(db,r.id,op)).version,1)
   assert.equal((await inspect(db,'SELECT count(*)::int n FROM rejoyce_security.billing_grace_notices'))[0].n,1)
  }finally{await db.close()}
 }
})
test('revoke review preserves history and emits owner-only notice, without leaking tickets or workforce identities',async()=>{
 const db=await createRecoveryDatabase();try{
  const r=await prepare(db);await workforce(db,ids.staff);await review(db,r.id,true);await workforce(db)
  const grant=await confirm(db,r.id,randomUUID());const revoke=await prepare(db,{action:'revoke',grace:grant.graceId,version:1,expires:null})
  await confirm(db,revoke.id,randomUUID());const current=await access(db);assert.equal(current.canWrite,false)
  assert.deepEqual(current.billingNotices.map(n=>n.action),['revoke','grant'])
  await workforce(db,ids.staff);assert.deepEqual((await access(db)).billingNotices,[])
  await inspect(db,'TRUNCATE rejoyce_security.billing_grace_review_permits')
  await db.exec('RESET ROLE');await assert.rejects(db.query('DELETE FROM rejoyce_security.billing_grace_notices'),/append-only/)
 }finally{await db.close()}
})
