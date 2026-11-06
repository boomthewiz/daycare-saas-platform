/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic browser -> real isolated database. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict')
const {createClinicalDatabase,ids,actor}=require('./helpers/clinical-access-db.cjs')
const base=process.env.TEST_BASE_URL||'http://localhost:3047'
;(async()=>{
 const db=await createClinicalDatabase(),browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{}),headless:true})
 let queue=Promise.resolve();const errors=[]
 const inspect=sql=>{const work=queue.then(async()=>{await db.exec('RESET ROLE');await db.exec(sql);await actor(db)});queue=work;return work}
 try{
  const user={id:ids.owner,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
  const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:ids.owner,session_id:ids.device,exp:Math.floor(Date.now()/1000)+36000,aal:'aal2'})).toString('base64url')+'.synthetic'
  const context=await browser.newContext({viewport:{width:1280,height:900}})
  await context.addInitScript(({user,token})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,token_type:'bearer',user})),{user,token})
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').pop()
   if(url.origin===new URL(base).origin){
    if(url.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}})
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
      const args={session_context_v2:["p_session","p_selected","p_location"],activity_class_context:[],list_group_activities:['p_from','p_to','p_branch','p_child','p_assigned','p_page'],scheduling_timezone:[],clinical_program_access:['p_client'],support_organization_lookup:['p_query','p_ticket','p_workforce_version'],effective_capabilities:[],subscription_access:['p_session_id'],current_organization_id:[],can_manage_clients:[],can_manage_users:[],can_manage_sessions:[],can_review_sessions:[],is_frontline_staff:[],care_context:['p_client_id'],client_branch_context:['p_client_id'],list_child_activity_groups:['p_child'],account_service_model:[],setup_progress:[],organization_setup_progress:[],session_people_readiness:[]}
      if(!Object.hasOwn(args,name)){throw new Error('Unexpected RPC '+name)}
      else {const keys=args[name];data=(await db.query(`SELECT public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) v`,keys.map(k=>body[k]??null))).rows[0].v}
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
  await page.goto(base+'/session/'+ids.session);await page.getByText('This workspace is unavailable for your current access.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:/Start|Finish|Pause/}).count(),0)
  await page.goto(base+'/reviews');await page.getByText('This workspace is unavailable for your current access.',{exact:true}).waitFor()
  await page.goto(base+'/sessions');await page.getByText('Getting started: Plan ordinary Activities',{exact:true}).waitFor()
  assert.equal(await page.locator('option[value="clinical"]').count(),0)
  assert.equal(await page.getByRole('link',{name:'Reviews',exact:true}).count(),0)
  await page.goto(base+'/clients/'+ids.client);await page.getByRole('heading',{name:'Synthetic destination',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:/^Targets/}).count(),0)
  assert.equal(await page.getByRole('button',{name:/^Behaviors/}).count(),0)
  await page.getByText('Getting started: Review the child profile',{exact:true}).waitFor()
  await page.screenshot({path:'../daycare-program-boundary.png',fullPage:true})
  await inspect(`INSERT INTO rejoyce_security.clinical_modules VALUES('${ids.org}',true,1);INSERT INTO rejoyce_security.clinical_program_grants VALUES('${ids.org}','${ids.owner}',true,false,1);`)
  await page.evaluate(()=>window.dispatchEvent(new Event('rejoyce:capabilities-changed')))
  await page.getByRole('button',{name:/^Targets/}).waitFor();await page.getByRole('button',{name:/^Targets/}).click()
  assert.ok(await page.getByRole('button',{name:'Add Target',exact:true}).first().isDisabled())
  await inspect(`UPDATE rejoyce_security.clinical_program_grants SET program_edit=true,version=2 WHERE user_id='${ids.owner}'`)
  await page.evaluate(()=>window.dispatchEvent(new Event('rejoyce:capabilities-changed')))
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Add Target'&&!b.matches(':disabled')))
  await inspect(`UPDATE rejoyce_security.clinical_modules SET enabled=false,version=2`)
  await page.evaluate(()=>window.dispatchEvent(new Event('rejoyce:capabilities-changed')))
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>/^Targets/.test(b.textContent.trim())))
  await page.goto(base+'/sessions');await page.getByText('Getting started: Plan ordinary Activities',{exact:true}).waitFor()
  assert.equal(await page.locator('option[value="clinical"]').count(),0)
  await inspect(`UPDATE rejoyce_security.clinical_modules SET enabled=true,version=3`)
  await page.evaluate(()=>window.dispatchEvent(new Event('rejoyce:capabilities-changed')))
  await page.getByText('Getting started: Schedule, prepare, then deliver care',{exact:true}).waitFor()
  assert.equal(await page.locator('option[value="clinical"]').count(),1)
  await inspect(`UPDATE rejoyce_security.clinical_program_grants SET program_read=false,program_edit=false,version=3`)
  await page.evaluate(()=>window.dispatchEvent(new Event('rejoyce:capabilities-changed')))
  await page.getByText('Getting started: Plan ordinary Activities',{exact:true}).waitFor()
  assert.equal(await page.locator('option[value="clinical"]').count(),0)
  await page.screenshot({path:'../clinical-access-daycare.png',fullPage:true})
  assert.deepEqual(errors,[]);console.log('PASS clinical routes, scheduling controls, program grants and live revocation through browser and isolated PostgreSQL')
 }finally{await queue;await browser.close();await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
