/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic PostgreSQL. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
async function database(){
 const db=await createFoundationsDatabase();await db.exec('RESET ROLE');
 for(const file of ['20261025012613_scheduling_timezone.sql','20261025020957_conflict_write_coverage.sql','20261105235840_launch_foundation.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'))
 await actor(db);await db.query("SELECT public.set_scheduling_timezone($1,'UTC',0)",[ids.org]);return db
}
async function enable(db,edit=true){
 await db.exec(`RESET ROLE; INSERT INTO rejoyce_security.clinical_modules VALUES('${ids.org}',true,1) ON CONFLICT(organization_id) DO UPDATE SET enabled=true;
 INSERT INTO rejoyce_security.clinical_program_grants VALUES('${ids.org}','${ids.owner}',true,${edit},1) ON CONFLICT(organization_id,user_id) DO UPDATE SET program_read=true,program_edit=${edit};`);await actor(db)
}
const insert=(db,child=ids.client)=>db.query('INSERT INTO public.client_targets(organization_id,client_id,title) VALUES($1,$2,$3) RETURNING id',[ids.org,child,'Synthetic clinical target'])
async function supportActor(db,aal='aal2'){
 await actor(db);await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.owner,session_id:ids.device,role:'authenticated',aal})])
}
async function enroll(db){
 await db.exec(`RESET ROLE; UPDATE auth.sessions SET aal='aal2' WHERE id='${ids.device}';INSERT INTO rejoyce_security.support_workforce VALUES('${ids.owner}','agent',true,1);`);await supportActor(db)
}
const lookup=(db,q='Synthetic',version=1)=>db.query('SELECT public.support_organization_lookup($1,$2,$3) v',[q,'CASE-123',version])
test('clinical program authority defaults deny independently of role, vocabulary and service model',async()=>{
 const db=await database();try{
  const access=async()=>(await db.query('SELECT public.clinical_program_access($1) v',[ids.client])).rows[0].v
  assert.equal((await access()).read,false);await assert.rejects(insert(db),/policy|Clinical/)
  assert.equal((await db.query('SELECT * FROM public.client_behaviors')).rows.length,0)
  await db.query("SELECT public.set_account_service_model($1,'aba',0)",[ids.org]);assert.equal((await access()).read,false)
  await db.exec(`RESET ROLE;INSERT INTO rejoyce_security.clinical_modules VALUES('${ids.org}',true,1)`);await actor(db)
  assert.equal((await access()).read,false);await assert.rejects(insert(db),/policy|Clinical/)
  await enable(db,false);assert.equal((await access()).read,true);assert.equal((await access()).edit,false)
  await assert.rejects(insert(db),/policy|Clinical/)
  await enable(db);const id=(await insert(db)).rows[0].id
  assert.equal((await access()).edit,true)
  await db.query('UPDATE public.client_targets SET title=$1 WHERE id=$2',['Reviewed',id])
  await assert.rejects(insert(db,ids.foreignClient),/policy|Clinical|foreign/)
  await assert.rejects(db.query('SELECT public.clinical_program_access($1)',[ids.foreignClient]),/unavailable/)
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.clinical_modules SET enabled=false WHERE organization_id='${ids.org}'`);await actor(db)
  assert.equal((await db.query('SELECT * FROM public.client_targets WHERE id=$1',[id])).rows.length,0)
  assert.equal((await db.query('DELETE FROM public.client_targets WHERE id=$1 RETURNING id',[id])).rows.length,0)
  await db.exec('RESET ROLE');assert.equal((await db.query('SELECT title FROM public.client_targets WHERE id=$1',[id])).rows[0].title,'Reviewed')
 }finally{await db.close()}
})
test('reusable behavior RPC, definer writes and live grant revocation cannot bypass program gates',async()=>{
 const db=await database();try{
  await assert.rejects(db.query('SELECT public.apply_client_behavior($1,$2)',[ids.client,ids.source]),/unavailable/)
  await enable(db)
  const id=(await db.query('SELECT public.apply_client_behavior($1,$2) id',[ids.client,ids.source])).rows[0].id;assert.ok(id)
  await db.exec(`RESET ROLE; CREATE FUNCTION public.synthetic_definer_write() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.client_behaviors(organization_id,client_id,name) VALUES('${ids.org}','${ids.client}','Should deny') $$;
 UPDATE rejoyce_security.clinical_program_grants SET program_edit=false,version=2 WHERE user_id='${ids.owner}'`);await actor(db)
  await assert.rejects(db.query('SELECT public.synthetic_definer_write()'),/Clinical/)
  assert.equal((await db.query('UPDATE public.client_behaviors SET name=$1 WHERE id=$2 RETURNING id',['Blocked',id])).rows.length,0)
  await db.exec(`RESET ROLE;UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}'`);await actor(db)
  await assert.rejects(db.query('SELECT public.clinical_program_access($1)',[ids.client]),/unlock|sign-in/)
 }finally{await db.close()}
})
test('support denies customer owners/admins, missing MFA, stale versions and revoked workforce/session/device',async()=>{
 const db=await database();try{
  await assert.rejects(lookup(db),/Support access/)
  await db.exec(`RESET ROLE;UPDATE public.users SET role='admin' WHERE id='${ids.owner}'`);await actor(db)
  await assert.rejects(lookup(db),/Support access/)
  await enroll(db);await supportActor(db,'aal1');await assert.rejects(lookup(db),/MFA/)
  await supportActor(db);await assert.rejects(lookup(db,'Synthetic',0),/Support access/)
  const data=(await lookup(db)).rows[0].v;assert.equal(data.organizations.length,2)
  assert.deepEqual(Object.keys(data.organizations[0]).sort(),['abaEnabled','id','model','modelVersion','moduleVersion','name'])
  assert.equal((await lookup(db,ids.foreignOrg)).rows[0].v.organizations[0].id,ids.foreignOrg,'explicit workforce metadata access is cross-tenant')
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.support_workforce SET active=false,version=2 WHERE user_id='${ids.owner}'`);await supportActor(db)
  await assert.rejects(lookup(db),/Support access/)
  await db.exec(`RESET ROLE;UPDATE rejoyce_security.support_workforce SET active=true WHERE user_id='${ids.owner}';UPDATE auth.sessions SET aal='aal1' WHERE id='${ids.device}'`);await supportActor(db)
  await assert.rejects(lookup(db,'Synthetic',2),/MFA/)
  await db.exec(`RESET ROLE;UPDATE auth.sessions SET aal='aal2',not_after=now()-interval '1 second' WHERE id='${ids.device}'`);await supportActor(db)
  await assert.rejects(lookup(db,'Synthetic',2),/MFA|unlock|sign-in/)
  await db.exec(`RESET ROLE;UPDATE auth.sessions SET not_after=NULL WHERE id='${ids.device}';UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${ids.owner}'`);await supportActor(db)
  await assert.rejects(lookup(db,'Synthetic',2),/MFA|unlock|sign-in/)
  await db.exec(`RESET ROLE;UPDATE auth.users SET banned_until=NULL WHERE id='${ids.owner}';UPDATE public.device_sessions SET revoked=true WHERE session_id='${ids.device}'`);await supportActor(db)
  await assert.rejects(lookup(db,'Synthetic',2),/unlock|sign-in/)

 }finally{await db.close()}
})
test('support audit is atomic and immutable; private authority tables are inaccessible',async()=>{
 const db=await database();try{
  await enroll(db);await lookup(db)
  for(const table of ['clinical_modules','clinical_program_grants','support_workforce','support_audit']){
   await assert.rejects(db.query(`SELECT * FROM rejoyce_security.${table}`),/permission denied/)
  }
  await assert.rejects(lookup(db,'%'),/prefix/)
  await db.exec(`RESET ROLE;CREATE FUNCTION rejoyce_security.synthetic_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
 CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON rejoyce_security.support_audit FOR EACH ROW EXECUTE FUNCTION rejoyce_security.synthetic_audit_failure();`);await supportActor(db)
  await assert.rejects(lookup(db),/Synthetic audit failure/)
  await db.exec('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int n FROM rejoyce_security.support_audit')).rows[0].n,1)
  await assert.rejects(db.query('DELETE FROM rejoyce_security.support_audit'),/append-only/)
  await assert.rejects(db.query("UPDATE rejoyce_security.support_audit SET ticket='rewrite'"),/append-only/)
  await assert.rejects(db.query('TRUNCATE rejoyce_security.support_audit'),/append-only/)
  const wrappers=(await db.query("SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('clinical_program_access','support_organization_lookup')")).rows
  assert.equal(wrappers.length,2);assert.ok(wrappers.every(r=>!r.prosecdef&&!r.anon))
 }finally{await db.close()}
})
test('daycare workflows remain available without clinical module or support membership',async()=>{
 const db=await database();try{
  assert.ok((await db.query('SELECT id FROM public.clients WHERE id=$1',[ids.client])).rows.length)
  const group=(await db.query('SELECT public.save_activity_class(NULL,NULL,$1,$2,$3,$4,true) v',['Synthetic daycare class',ids.north,[ids.client],[ids.staff]])).rows[0].v
  assert.ok(group.id)
  const activity=(await db.query("SELECT public.create_scheduled_context_session($1,$2,'2027-01-22T16:00Z','2027-01-22T17:00Z','direct_therapy',NULL,'{}',gen_random_uuid(),'activity') v",[ids.client,ids.staff])).rows[0].v
  assert.ok(activity.session_id)
 }finally{await db.close()}
})
