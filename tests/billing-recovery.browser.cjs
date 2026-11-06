/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic browser -> real isolated database. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const base=process.env.TEST_BASE_URL||'http://localhost:3047'
;(async()=>{
 const db=await createFoundationsDatabase(),browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{}),headless:true})
 let queue=Promise.resolve();const errors=[];let accessReads=0
 const inspect=sql=>{const work=queue.then(async()=>{await db.exec('RESET ROLE');await db.exec(sql);await actor(db)});queue=work;return work}
 try{
  await inspect(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261105235840_launch_foundation.sql'),'utf8'));await inspect(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261106003941_billing_recovery_grace.sql'),'utf8'))
  const user={id:ids.owner,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
  const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:ids.owner,session_id:ids.device,exp:Math.floor(Date.now()/1000)+36000,aal:'aal2'})).toString('base64url')+'.synthetic'
  const context=await browser.newContext({viewport:{width:1280,height:900}})
  await context.addInitScript(({user,token})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,token_type:'bearer',user})),{user,token})
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').pop()
   if(url.origin===new URL(base).origin){
    if(url.pathname==='/api/session-policy')return route.fulfill({json:{enabled:true}})
    if(url.pathname==='/api/device-session')return route.fulfill({json:{state:'unlocked',serverNow:new Date().toISOString(),unlockedUntil:new Date(Date.now()+3600000).toISOString(),fullAuthUntil:new Date(Date.now()+3600000).toISOString(),pinRequiredBy:new Date(Date.now()+86400000).toISOString()}})
    if(url.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}})
    if(url.pathname.startsWith('/api/'))return route.continue()
    return route.continue()
   }
   if(url.origin!=='https://workflow-test.supabase.co')return route.abort()
   queue=queue.then(async()=>{
    try{
     let data=[];const body=request.postData()?request.postDataJSON():{}
     if(url.pathname==='/auth/v1/user')data=user
     else if(url.pathname.includes('/rpc/')){
      const args={activity_class_context:[],list_group_activities:['p_from','p_to','p_branch','p_child','p_assigned','p_page'],scheduling_timezone:[],clinical_program_access:['p_client'],support_organization_lookup:['p_query','p_ticket','p_workforce_version'],effective_capabilities:[],subscription_access:['p_session_id'],current_organization_id:[],can_manage_clients:[],can_manage_users:[],can_manage_sessions:[],can_review_sessions:[],is_frontline_staff:[],care_context:['p_client_id'],client_branch_context:['p_client_id'],list_child_activity_groups:['p_child'],account_service_model:[],setup_progress:[],organization_setup_progress:[],session_people_readiness:[]}
      if(!Object.hasOwn(args,name)){throw new Error('Unexpected RPC '+name)}
      else {if(name==='subscription_access')accessReads++;const keys=args[name];data=(await db.query(`SELECT public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) v`,keys.map(k=>body[k]??null))).rows[0].v}
     }else{
      const tables=['clients','users','sessions','session_types','organization_locations','organization_terminology','organizations','user_permissions','client_targets','client_behaviors','target_categories','client_locations']
      if(!tables.includes(name))throw new Error('Unexpected table '+name)
      if(request.method()!=='GET')throw new Error('Unexpected direct mutation')
      data=(await db.query(`SELECT ${name==='users'?'id,organization_id,email,full_name,role,status':'*'} FROM public.${name}`)).rows
      for(const [key,value] of url.searchParams){if(value.startsWith('eq.'))data=data.filter(r=>String(r[key])===value.slice(3));if(value.startsWith('in.('))data=data.filter(r=>value.slice(4,-1).split(',').includes(r[key]))}
      if((request.headers().accept||'').includes('vnd.pgrst.object'))data=data[0]||null
     }
     await route.fulfill({json:data})
    }catch(cause){if(!cause.code)errors.push(cause.message);await route.fulfill({status:400,json:{message:cause.message,code:cause.code||'FIXTURE'}})}
   });return queue
  })
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message))
  await inspect(`INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload) VALUES('${ids.org}','${ids.owner}',now()-interval '40 days',now()-interval '10 days','{}');UPDATE auth.sessions SET aal='aal2' WHERE id='${ids.device}';INSERT INTO rejoyce_security.support_workforce VALUES('${ids.owner}','billing',true,1);INSERT INTO rejoyce_security.billing_grace_policies VALUES(1,true,3600,0,300,false,'${ids.owner}','POLICY-1',now());`)
  await queue;await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.owner,session_id:ids.device,role:'authenticated',aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]})])
  await db.query("SELECT public.support_billing_grace('grant',$1,NULL,0,1,now()+interval '30 minutes','CASE-123','payment_recovery',gen_random_uuid(),1)",[ids.org])
  await page.goto(base+'/billing');await page.getByRole('heading',{name:'Organization subscription',exact:true}).waitFor()
  await page.getByRole('status').filter({hasText:'Temporary support grace ends'}).waitFor()
  await page.getByRole('complementary',{name:'Organization access'}).getByText(/Temporary support grace enables editing/).waitFor()
  assert.ok(await page.getByRole('button',{name:'Subscribe',exact:true}).isDisabled(),'recovery does not enable charges')
  const count=accessReads;await page.waitForTimeout(250);assert.ok(accessReads-count<5,'grace deadline does not create an expired-trial refresh loop')
  await page.screenshot({path:'../billing-grace-synthetic.png',fullPage:true})
  await inspect("UPDATE rejoyce_security.billing_graces SET starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'")
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await page.getByText('Your organization has read-only access. Sessions underway when the trial ended may be finished and their notes submitted.').first().waitFor()
  assert.equal(await page.getByRole('status').filter({hasText:'Temporary support grace ends'}).count(),0)
  assert.deepEqual(errors,[]);console.log('Billing recovery browser passed: truthful grace label, no charging, stable refresh and server-expiry read-only access.')
 }finally{await browser.close();await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
