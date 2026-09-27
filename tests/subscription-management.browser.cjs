// Synthetic browser acceptance: never writes to or emails a real organization.
const {chromium}=require('playwright'),assert=require('node:assert/strict')
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3017'
const id='22222222-2222-4222-8222-222222222222',org='33333333-3333-4333-8333-333333333333'
const user={id,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.'+Buffer.from('synthetic').toString('base64url')
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 let page,mode='expired',accessFailure=false,writes=0
 const context=await browser.newContext({viewport:{width:1280,height:900}})
 try{
  await context.addInitScript(({token,user})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,expires_in:36000,token_type:'bearer',user})),{token,user})
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname
   if(url.origin===new URL(base).origin){
    if(p==='/api/session-policy')return route.fulfill({json:{enabled:false}})
    if(p==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}})
    if(p.startsWith('/api/')){writes++;return route.fulfill({status:503,json:{error:'Unexpected write in read-only test'}})}
    return route.continue()
   }
   if(url.origin!=='https://workflow-test.supabase.co')return route.abort()
   let data=[]
   if(p==='/auth/v1/user')data=user
   else if(p.endsWith('/rpc/subscription_access')){
    if(accessFailure)return route.fulfill({status:503,json:{message:'Synthetic access failure'}})
    const now=Date.now()
    data={managed:mode!=='legacy',canWrite:mode!=='expired',canFinishSession:mode!=='expired',serverNow:new Date(now).toISOString(),trialEndsAt:new Date(now+(mode==='expired'?-1000:mode==='expiring'?1800:86400000)).toISOString(),canManageBilling:true}
   }
   else if(p.endsWith('/rpc/current_organization_id'))data=org
   else if(p.includes('/rpc/can_'))data=true
   else if(route.request().method()!=='GET'){writes++;return route.fulfill({status:403,json:{message:'Unexpected write'}})}
   else if(p.endsWith('/users')){
    const member=url.searchParams.get('id')==='eq.'+org
    const profile={...user,id:member?org:id,full_name:member?'Synthetic Worker':'Synthetic Owner',organization_id:org,role:member?'teacher':'owner',status:'active'}
    data=url.searchParams.has('id')?profile:[profile]
   }
   else if(p.endsWith('/user_permissions'))data={can_manage_users:true,can_manage_operations:true,can_manage_clients:true}
   else if(p.endsWith('/session_types'))data=[{id:org,name:'Synthetic service',code:'synthetic',active:true,sort_order:0,default_duration_minutes:60}]
   else if(p.endsWith('/organization_locations'))data=[{id:org,name:'Main',active:true,sort_order:0}]
   else if(p.endsWith('/organization_terminology'))data=null
   else if(p.endsWith('/clients')){
    const client={id:org,organization_id:org,first_name:'Synthetic Client',last_name:'',status:'active',client_locations:[{location_id:org}]}
    data=url.searchParams.has('id')?client:[client]
   }
   else if(p.endsWith('/client_locations'))data=[{location_id:org}]
   else if(p.endsWith('/sessions'))data=url.searchParams.has('id')?{id:org,organization_id:org,client_id:org,status:'scheduled',session_type:'synthetic',created_at:new Date().toISOString(),scheduled_start:new Date().toISOString(),scheduled_end:new Date(Date.now()+3600000).toISOString(),started_at:null,total_paused_seconds:0}:[]
   else if(p.endsWith('/session_notes'))data=null
   await route.fulfill({json:data})
  })
  page=await context.newPage();page.setDefaultTimeout(20000)
  page.on('pageerror',error=>console.error('Browser error:',error.message))
  await page.goto(base+'/operations')
  await page.getByRole('button',{name:'Add Session Type',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Add Session Type',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Edit',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).isEnabled(),true)
  await page.getByRole('button',{name:'Branches',exact:true}).click()
  await page.getByText('Main',{exact:true}).last().waitFor()
  await page.goto(base+'/team-management')
  await page.getByRole('button',{name:'Add Client',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Add Client',exact:true}).isDisabled(),true)
  const search=page.getByPlaceholder(/Search/)
  await search.fill('Synthetic Client')
  await page.getByText('Synthetic Client',{exact:true}).waitFor()
  await page.getByRole('button',{name:/Team Members/}).click()
  const invite=page.getByRole('link',{name:'Invite Team Member',exact:true})
  await invite.click({force:true})
  assert.equal(new URL(page.url()).pathname,'/team-management')
  await page.goto(base+'/team-management/invite')
  assert.equal(await page.locator('button[type=submit]').isDisabled(),true)
  await page.goto(base+'/sessions')
  assert.equal(await page.locator('button[type=submit]').isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).isEnabled(),true)
  await page.goto(base+'/clients/'+org)
  await page.getByRole('button',{name:'Archive Client',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Archive Client',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Save branches',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:/Targets/}).click()
  assert.equal(await page.getByRole('button',{name:'Add Target',exact:true}).first().isDisabled(),true)
  await page.goto(base+'/team-management/'+org)
  await page.getByRole('button',{name:'Save Profile',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Save Profile',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Resend Setup Email',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Require PIN Reset',exact:true}).isEnabled(),true)
  await page.goto(base+'/sessions/'+org)
  assert.equal(await page.getByRole('button',{name:'Save Session',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Cancel Session',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Prepare Targets',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('link',{name:'Open note and history',exact:true}).isEnabled(),true)
  await page.goto(base+'/profile')
  assert.equal(await page.getByRole('button',{name:/Save Profile/}).isDisabled(),true)
  assert.equal(await page.getByLabel('New PIN',{exact:true}).isEnabled(),true)
  // Editing restores for an active trial and for unenrolled legacy organizations.
  for(mode of ['active','legacy']){
   await page.goto(base+'/operations')
   await page.getByRole('button',{name:'Add Session Type',exact:true}).click()
   await page.locator('form').waitFor()
   assert.equal(await page.locator('form input').first().isEnabled(),true)
  }
  // The deadline timer refreshes immediately, without waiting for the minute poll.
  mode='expiring'
  await page.goto(base+'/operations')
  await page.getByRole('button',{name:'Add Session Type',exact:true}).click()
  await page.locator('form input').first().fill('Retained at expiration')
  mode='expired'
  await page.getByText('Read-only access: you can browse records, but organization changes are unavailable.').waitFor()
  assert.equal(await page.locator('form input').first().isDisabled(),true)
  assert.equal(await page.locator('form input').first().inputValue(),'Retained at expiration')
  accessFailure=true
  await page.reload()
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Add Session Type',exact:true}).isDisabled(),true)
  accessFailure=false;mode='active'
  await page.getByRole('button',{name:'Try again',exact:true}).click()
  await page.getByRole('button',{name:'Add Session Type',exact:true}).click()
  assert.equal(writes,0,'Read-only interaction and browsing must not send write requests')
  console.log('PASS: read-only operations, people, invitation, scheduling and profile; browsing retained; active/legacy access; expiry deadline; access-failure recovery')
 }catch(error){if(page)console.error((await page.locator('body').innerText()).slice(0,4500));throw error}
 finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
