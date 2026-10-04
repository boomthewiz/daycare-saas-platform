const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('fs');
const base=process.env.TEST_BASE_URL || 'http://localhost:3037',org='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const user={id,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}};
const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.synthetic';
const auth={access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,expires_in:36000,token_type:'bearer',user};
const types=[{id:'type-a',organization_id:org,code:'custom_visit',name:'Configured visit',active:true,default_duration_minutes:45,sort_order:0},{id:'type-b',organization_id:org,code:'retired_visit',name:'Retired visit',active:false,default_duration_minutes:60,sort_order:1},{id:'type-c',organization_id:org,code:'unused_retired',name:'Unused retired',active:false,default_duration_minutes:60,sort_order:2}];
const client={id:'client-one',organization_id:org,first_name:'Synthetic Client',last_name:null,preferred_name:null,status:'active',assigned_provider_id:id,client_locations:[],created_at:new Date().toISOString()};
let saved={id:'session-one',organization_id:org,client_id:'client-one',provider_id:id,supervisor_id:null,session_type:'retired_visit',status:'scheduled',attendance_status:'pending',scheduled_start:new Date(Date.now()+3600000).toISOString().replace(/\d{2}\.\d{3}Z$/,'00.000Z'),scheduled_end:new Date(Date.now()+7200000).toISOString().replace(/\d{2}\.\d{3}Z$/,'00.000Z'),started_at:null,total_paused_seconds:0,location:'North',was_supervised:false,updated_at:new Date().toISOString()};
saved={...saved,created_at:new Date().toISOString(),prepared_at:null,prepared_by:null,completed_at:null,paused_at:null};
// All authentication, business and save responses are synthetic. Configure the local server with workflow-test.supabase.co and synthetic keys.
// Supply Playwright via NODE_PATH, matching existing browser harnesses. Run from the repository root.
fs.mkdirSync('work/setup-guide-evidence',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});try { const results=[],writes=[],queries=[];
 let denied=false,readonly=false,typeFailure=false,slow=false;
 const ctx=await browser.newContext();await ctx.addInitScript(s=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify(s)),auth);
 await ctx.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin===base){if(u.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}});if(u.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}});return route.continue();}
  if(u.origin!=='https://workflow-test.supabase.co')return route.abort();
  const table=u.pathname.split('/').pop(),singular=(req.headers().accept||'').includes('vnd.pgrst.object');let data=[];
  if(req.method()==='PATCH'&&table==='users')throw new Error('Profile must remain read-only under current policies.');
  if(req.method()==='PATCH'&&table==='sessions'){
   assert(!denied&&!readonly);writes.push(req.postDataJSON());saved={...saved,...req.postDataJSON(),updated_at:new Date().toISOString()};return route.fulfill({json:{id:saved.id}});
  }
  if(table==='user')data=user;
  if(table==='users')data=singular?{id,full_name:'Synthetic Owner',role:'owner',organization_id:org,status:'active'}:[{id,full_name:'Synthetic Provider',role:'teacher',organization_id:org,status:'active'}];
  if(table==='clients')data=singular?client:[client];
  if(table==='sessions'){if(slow)await new Promise(resolve=>setTimeout(resolve,2500));data=singular?saved:[saved];}
  if(table==='session_types'){queries.push(u.searchParams.get('organization_id'));if(typeFailure)return route.fulfill({status:503,json:{message:'Synthetic configuration interruption'}});data=types;}
  if(table==='organization_locations')data=[{id:'north',name:'North',active:true,organization_id:org,sort_order:0}];
  if(table==='organization_terminology'||table==='session_notes')data=singular?null:[];
  if(table==='current_organization_id')data=org;
  if(table==='subscription_access')data={managed:false,canWrite:!readonly,canFinishSession:true};
  if(table.startsWith('can_'))data=!denied;
  if(table==='care_context')data={staff:[],groups:[],location_ids:[],member_ids:[],primary_id:null,version:null};
  return route.fulfill({json:data});
 });
 const page=await ctx.newPage();page.on('pageerror',error=>console.log('Page error: '+error.stack));
 const routes=['/setup','/setup/preferences','/setup/care-teams','/setup/roles','/team-management','/clients/client-one','/sessions','/sessions/session-one','/sessions/session-one/edit'];
 for(const width of [320,375,390,430,640,768,1280]){
  await page.setViewportSize({width,height:900});
  for(const route of routes){
   await page.goto(base+route);const summary=page.locator('summary').filter({hasText:'Getting started:'});try{await summary.waitFor({timeout:6000})}catch(e){console.log(await page.locator('body').innerText());throw e;}
   const details=summary.locator('..');assert.equal(await details.getAttribute('open'),null);await summary.click();await details.locator('ol').waitFor();
   const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);
   const overflow=scroll>width?await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(x=>x.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(x).position!=='absolute').slice(-18).map(x=>({tag:x.tagName,class:x.className,text:x.textContent.slice(0,50),width:x.getBoundingClientRect().width}))):[];
   results.push({route,width,scroll,open:true,overflow});
   if(scroll!==width)console.log(JSON.stringify({route,width,scroll,overflow}));assert.equal(scroll,width,route+' at '+width+'px');
   if(width===390&&route==='/setup')await page.screenshot({path:'work/setup-guide-evidence/setup-guide-mobile.png',fullPage:true});
   if(width===1280&&route==='/sessions/session-one/edit')await page.screenshot({path:'work/setup-guide-evidence/configured-session-types.png',fullPage:true});
   await summary.click();assert.equal(await details.getAttribute('open'),null);
  }
 }
 await page.goto(base+'/sessions/session-one/edit');const select=page.getByLabel('Session type',{exact:true});await select.waitFor();
 assert.equal(await select.inputValue(),'retired_visit');assert.deepEqual(await select.locator('option').evaluateAll(xs=>xs.map(x=>x.value)),['custom_visit','retired_visit']);
 const original={start:saved.scheduled_start,end:saved.scheduled_end};await select.selectOption('custom_visit');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Session details saved successfully.').waitFor();
 assert.equal(saved.session_type,'custom_visit');assert.equal(saved.scheduled_start,original.start);assert.equal(saved.scheduled_end,original.end);assert(queries.includes('eq.'+org));
 await page.reload();await select.waitFor();assert.equal(await select.inputValue(),'custom_visit');
 saved.session_type='legacy_missing';await page.reload();await select.waitFor();assert.equal(await select.inputValue(),'legacy_missing');assert.match(await select.locator('option:checked').innerText(),/saved type/);
 typeFailure=true;await page.reload();await page.getByText('Unable to load configured service types. Refresh before changing the type.').waitFor();assert(await select.isDisabled());assert.equal(await select.inputValue(),'legacy_missing');typeFailure=false;
 denied=true;await page.reload();await page.getByText('You do not have permission to edit sessions.').waitFor();assert(await select.isDisabled());assert(await page.getByRole('button',{name:'Save',exact:true}).isDisabled());denied=false;
 readonly=true;await page.reload();await page.getByText('Read-only access:',{exact:false}).waitFor();assert(await select.isDisabled());readonly=false;
 saved.status='completed';await page.reload();await select.waitFor();assert(await select.isDisabled());saved.status='scheduled';
 denied=true;await page.goto(base+'/setup/roles');await page.getByText('Manage users permission is required to manage accounts.').waitFor();assert.equal(await page.getByRole('link',{name:'Invite team member',exact:true}).count(),0);await page.locator('summary').click();await page.getByText('Your access:',{exact:false}).waitFor();denied=false;
 slow=true;await page.setViewportSize({width:320,height:900});await page.goto(base+'/dashboard');await page.getByText('Preparing your workspace…').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);await page.getByText('Welcome back, Synthetic').waitFor();slow=false;
 for(const [old,target] of [['/children','/team-management'],['/teachers','/setup/roles'],['/onboarding','/dashboard'],['/operations','/setup/preferences'],['/team-management/care-setup','/setup/care-teams']]){await page.goto(base+old);await page.waitForURL(base+target);}
 const beforeProfile=writes.length;await page.goto(base+'/profile');await page.getByText('Account details are read-only here. You can manage your PIN below.').waitFor();await page.getByText('Synthetic Owner',{exact:true}).waitFor();assert.equal(await page.locator('input[type="tel"]').count(),0);assert.equal(await page.getByRole('button',{name:'Save Profile',exact:false}).count(),0);assert.equal(writes.length,beforeProfile);
 await ctx.close();await browser.close();fs.writeFileSync('work/setup-guide-evidence/guide-verification.json',JSON.stringify({results,writes,queries,passed:true},null,2));
 console.log(JSON.stringify({cases:results.length,overflow:results.filter(x=>x.width!==x.scroll),savedFlows:writes.length,passed:true}));
} finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
