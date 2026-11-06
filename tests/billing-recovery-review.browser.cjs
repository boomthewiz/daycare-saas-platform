/* eslint-disable @typescript-eslint/no-require-imports -- Browser to current isolated recovery schema, two independent workforce actors. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict')
const {createRecoveryDatabase,workforce,ids}=require('./helpers/billing-recovery-db.cjs')
const base=process.env.TEST_BASE_URL||'http://localhost:3047'
;(async()=>{
 const db=await createRecoveryDatabase(),browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{}),headless:true})
 let queue=Promise.resolve(),loseConfirmation=true;const errors=[]
 const inspect=sql=>{const task=queue.then(async()=>{await db.exec('RESET ROLE');return db.query(sql)});queue=task.then(()=>{});return task}
 try{
  async function openAs(userId){
   const device=userId===ids.owner?ids.device:ids.staffDevice
   const user={id:userId,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
   const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,session_id:device,exp:Math.floor(Date.now()/1000)+36000,aal:'aal2'})).toString('base64url')+'.synthetic'
   const context=await browser.newContext({viewport:{width:1280,height:900}})
   await context.addInitScript(({user,token})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,token_type:'bearer',user})),{user,token})
   await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').pop()
    if(url.origin===new URL(base).origin){if(url.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}});if(url.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}});if(url.pathname.startsWith('/api/'))return route.fulfill({status:403,json:{error:'No external operations in fixture'}});return route.continue()}
    if(url.origin!=='https://workflow-test.supabase.co')return route.abort()
    queue=queue.then(async()=>{try{
     await workforce(db,userId);let data=[];const body=request.postData()?request.postDataJSON():{}
     if(url.pathname==='/auth/v1/user')data=user
     else if(url.pathname.includes('/rpc/')){
      const args={support_organization_lookup:['p_query','p_ticket','p_workforce_version'],support_billing_context:['p_org','p_ticket','p_workforce_version'],prepare_billing_grace:['p_action','p_org','p_grace','p_expected_version','p_policy_version','p_expires','p_ticket','p_reason','p_workforce_version'],inspect_billing_grace_review:['p_review','p_org','p_approve','p_workforce_version'],confirm_billing_grace:['p_review','p_org','p_operation','p_workforce_version'],subscription_access:['p_session_id'],effective_capabilities:[],current_organization_id:[],scheduling_timezone:[],account_service_model:[],list_group_activities:['p_from','p_to','p_branch','p_child','p_assigned','p_page'],can_manage_clients:[],can_manage_sessions:[],can_manage_users:[],can_review_sessions:[],is_frontline_staff:[]}
      if(!Object.hasOwn(args,name))throw new Error('Unexpected RPC '+name)
      data=(await db.query(`SELECT public.${name}(${args[name].map((_,i)=>'$'+(i+1)).join(',')}) v`,args[name].map(k=>body[k]??null))).rows[0].v
      if(name==='confirm_billing_grace'&&loseConfirmation){loseConfirmation=false;return route.fulfill({status:503,json:{message:'Synthetic committed response lost'}})}
     }else{
      const allowed=['users','clients','sessions','session_types','organization_locations','organization_terminology','organizations','user_permissions','client_locations','session_notes']
      if(request.method()!=='GET'||!allowed.includes(name))throw new Error('Unexpected direct business operation '+name)
      data=(await db.query(`SELECT ${name==='users'?'id,organization_id,full_name,email,role,status':'*'} FROM public.${name}`)).rows
      for(const [k,v] of url.searchParams){if(v.startsWith('eq.'))data=data.filter(r=>String(r[k])===v.slice(3))}
      if((request.headers().accept||'').includes('vnd.pgrst.object'))data=data[0]||null
     }
     return route.fulfill({json:data})
    }catch(cause){if(!cause.code)errors.push(cause.message);return route.fulfill({status:400,json:{message:cause.message,code:cause.code||'FIXTURE'}})}});return queue
   })
   const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));return {context,page}
  }
  const operator=await openAs(ids.owner),approver=await openAs(ids.staff)
  async function selectOrganization(page){await page.goto(base+'/support');await page.getByLabel('Organization ID or name prefix').fill(ids.org);await page.getByLabel('Ticket reference').fill('CASE-123');await page.getByRole('button',{name:'Look up organization',exact:true}).click();await page.getByRole('button',{name:'Review billing recovery',exact:true}).click();await page.getByRole('region',{name:'Billing recovery',exact:true}).getByRole('heading',{name:'Synthetic A',exact:true}).waitFor()}
  const page=operator.page;await selectOrganization(page)
  const expiry=new Date(Date.now()+1800000).toISOString().slice(0,16);await page.getByLabel('Expiry (UTC)',{exact:true}).fill(expiry)
  await page.getByRole('button',{name:'Preview recovery change',exact:true}).click()
  const preview=page.getByRole('region',{name:'Recovery change preview',exact:true});await preview.waitFor()
  assert.ok(await preview.getByRole('button',{name:'Confirm recovery change',exact:true}).isDisabled())
  assert.equal(await preview.getByRole('button',{name:'Approve this recovery',exact:true}).count(),0)
  const reviewId=(await inspect('SELECT id FROM rejoyce_security.billing_grace_reviews ORDER BY created_at DESC LIMIT 1')).rows[0].id
  await selectOrganization(approver.page);await approver.page.getByLabel('Recovery review reference',{exact:true}).fill(reviewId);await approver.page.getByRole('button',{name:'Load recovery review',exact:true}).click()
  await approver.page.getByRole('button',{name:'Approve this recovery',exact:true}).click();await approver.page.getByRole('status').filter({hasText:'Independent approval recorded.'}).waitFor()
  await selectOrganization(page);await page.getByLabel('Recovery review reference',{exact:true}).fill(reviewId);await page.getByRole('button',{name:'Load recovery review',exact:true}).click();await preview.getByRole('button',{name:'Confirm recovery change',exact:true}).click()
  await preview.getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();await preview.getByRole('button',{name:'Retry confirmation',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Recovery change saved with audit'}).waitFor()
  assert.equal((await inspect('SELECT count(*)::int n FROM rejoyce_security.billing_graces')).rows[0].n,1)
  assert.equal((await inspect('SELECT count(*)::int n FROM rejoyce_security.billing_grace_notices')).rows[0].n,1)
  for(const width of [375,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'recovery fits '+width)}
  await page.screenshot({path:'../recovery-reviewed-support.png',fullPage:true})
  await page.goto(base+'/billing');await page.getByRole('region',{name:'Support access notices',exact:true}).getByText(/Temporary support grace was granted until/).waitFor();assert.ok(await page.getByRole('button',{name:'Subscribe',exact:true}).isDisabled())
  await selectOrganization(page);await page.getByLabel('Recovery action',{exact:true}).selectOption('revoke');await page.getByRole('button',{name:'Preview recovery change',exact:true}).click();await page.getByRole('button',{name:'Confirm recovery change',exact:true}).click();await page.getByRole('status').filter({hasText:'Recovery change saved with audit'}).waitFor()
  await page.goto(base+'/billing');await page.getByRole('region',{name:'Support access notices',exact:true}).getByText(/Support grace was revoked/).waitFor()
  await inspect('UPDATE rejoyce_security.billing_grace_policies SET active=false');await selectOrganization(page);await page.getByRole('status').filter({hasText:'No approved recovery policy is active.'}).waitFor();assert.equal(await page.getByRole('button',{name:'Preview recovery change',exact:true}).count(),0)
  assert.deepEqual(errors,[]);console.log('Reviewed recovery browser passed: independent approval, interrupted-confirmation retry, one audit/notice, revoke, no-policy denial and mobile layout.')
 }finally{await browser.close();await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
