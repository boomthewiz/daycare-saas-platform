/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic visual fixture; blocks business writes. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),assert=require('node:assert/strict')
const base=process.env.TEST_BASE_URL||'http://localhost:3047',org='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111',child='33333333-3333-4333-8333-333333333333'
const user={id,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.synthetic'
const person={...user,organization_id:org,full_name:'Synthetic Owner',role:'owner',status:'active',created_at:new Date().toISOString()}
const client={id:child,organization_id:org,first_name:'Synthetic Child',last_name:null,preferred_name:null,status:'active',assigned_provider_id:id,client_locations:[],created_at:new Date().toISOString()}
const branch={id:'branch-one',organization_id:org,name:'Synthetic branch',active:true,sort_order:0}
const caps={userId:id,organizationId:org,clients:true,users:true,sessions:true,reports:true,reviews:true,billing:true,accessRequests:true,attendance:true,canWrite:true,owner:true,reportingTimezone:'America/Chicago',reportingToday:'2026-10-20'}
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Visual fixture must use a local server')
const results=[],errors=[],blocked=[],unknown=[]
fs.mkdirSync('work/form-field-evidence',{recursive:true})
;(async()=>{const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});try{
 let denyCapabilities=false;let refreshGate=null,releaseRefresh,markWaiting,scheduled=false;const waitingNames=new Set()
 const ctx=await browser.newContext();await ctx.addInitScript(({user,token})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,token_type:'bearer',user})),{user,token})
 await ctx.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),name=u.pathname.split('/').pop(),single=(req.headers().accept||'').includes('vnd.pgrst.object');
 if(u.origin===base){if(u.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}});if(u.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}});if(u.pathname.startsWith('/api/')){if(req.method()!=='GET')blocked.push(req.method()+' '+u.pathname);return route.fulfill({status:403,json:{error:'Writes blocked in synthetic visual fixture'}})}return route.continue()}
 if(u.origin!=='https://workflow-test.supabase.co')return route.abort()
 let data=[]
 if(u.pathname==='/auth/v1/user')data=user
 else if(u.pathname.includes('/rpc/')){
 if(denyCapabilities&&name==='effective_capabilities')return route.fulfill({status:403,json:{message:'Synthetic identity not authorized'}})
 if(refreshGate&&['effective_capabilities','onboarding_progress','account_service_model'].includes(name)){waitingNames.add(name);if(waitingNames.size===3)markWaiting();await refreshGate}
 const values={scheduling_timezone:{organizationId:org,userId:id,timezone:'America/Chicago',version:1,canManage:true,canWrite:true,updatedAt:null,updatedBy:null},account_service_model:{organizationId:org,userId:id,model:'unconfirmed',version:0,canManage:true,canWrite:true,updatedAt:null,updatedBy:null},activity_class_context:{organizationId:org,userId:id,canEdit:true,canWrite:true,classes:[],children:[],staff:[],branches:[branch]},list_group_activities:{rows:[],hasMore:false},current_organization_id:org,effective_capabilities:caps,onboarding_progress:{can_clients:true,can_users:true,can_sessions:true,can_write:true,session_type:true,client:true,staff_ready:true,scheduled,branch:true,care:true,staff:[]},subscription_access:{managed:false,canWrite:true,canFinishSession:true},session_people_readiness:{missing_clients:false,missing_staff:false},session_context_v2:{organizationId:org,userId:id,choices:[],recent:[],tags:[]},search_session_choices:{rows:[],hasMore:false},care_context:{staff:[],groups:[],location_ids:[],member_ids:[],primary_id:null,version:null},attendance_activation:{branches:[],blockers:[],ready:false},attendance_context:{organizationId:org,userId:id,view:true,record:false,correct:false,reports:true,canWrite:true,timezone:'America/Chicago',branches:[branch],staff:[],scopes:[]},attendance_read:{asOf:new Date().toISOString(),timezone:'America/Chicago',page:0,hasMore:false,rows:[],children:[]},task_workspace:{organizationId:org,userId:id,date:'2026-10-20',timezone:'America/Chicago',manager:true,canWrite:true,rows:[],hasMore:false,staff:[]}}
 if(Object.hasOwn(values,name))data=values[name];else if(name.startsWith('can_'))data=true;else if(name==='is_frontline_staff')data=false;else{unknown.push(name);return route.fulfill({status:400,json:{message:'Unconfigured visual fixture: '+name}})}
 }else{if(req.method()!=='GET'){blocked.push(name);return route.fulfill({status:403,json:{message:'No business writes in visual fixture'}})}const tables={users:[person],clients:[client],sessions:[],organization_locations:[branch],session_types:[{id:'type-one',organization_id:org,name:'Ordinary activity',code:'activity',active:true,default_duration_minutes:30,sort_order:0}],organization_terminology:[],organizations:[{id:org,name:'Synthetic organization'}],user_permissions:[],client_locations:[],client_targets:[],client_behaviors:[],session_notes:[],target_categories:[]};data=tables[name]||[];if(single)data=data[0]||null}
 return route.fulfill({json:data})})
 const page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({route:new URL(page.url()).pathname,error:e.message}))
 // The real provider timers must not unmount walkthrough/checklist DOM while RPCs wait.
 await page.clock.install();await page.goto(base+'/setup')
 await page.getByText('3 of 4 applicable milestones complete',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Start walkthrough',exact:true}).click();await page.getByRole('button',{name:'Next',exact:true}).click()
 await page.getByRole('region',{name:'Page walkthrough',exact:true}).waitFor()
 await page.evaluate(()=>{window.refreshNodes={tour:document.querySelector('[aria-label="Page walkthrough"]'),list:document.querySelector('[aria-labelledby="setup-progress-title"] ol'),nav:document.querySelector('nav[aria-label="Main navigation"] a')};window.refreshNodes.tour.dataset.preserved='yes'})
 const waiting=new Promise(resolve=>{markWaiting=resolve});refreshGate=new Promise(resolve=>{releaseRefresh=resolve})
 await page.clock.fastForward(60000);await waiting
 assert.equal(await page.getByText('Checking setup progress…',{exact:true}).count(),0)
 assert.ok(await page.getByRole('region',{name:'Page walkthrough',exact:true}).isVisible())
 assert.ok(await page.evaluate(()=>Object.values(window.refreshNodes).every(node=>node.isConnected)),'refresh must preserve the open walkthrough, checklist and navigation')
 scheduled=true;refreshGate=null;releaseRefresh()
 await page.getByText('4 of 4 applicable milestones complete',{exact:true}).waitFor()
 assert.equal(await page.getByRole('region',{name:'Page walkthrough',exact:true}).getAttribute('data-preserved'),'yes')
 results.push({route:'/setup',state:'background refresh preserves walkthrough and applies changed readiness',passed:true})
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.clock.resume()
 await page.evaluate(()=>{window.verifiedModel=document.querySelector('[aria-label="Business service model"]')})
 const renewed=page.waitForResponse(r=>r.url().endsWith('/rpc/effective_capabilities'))
 await page.evaluate(()=>{const channel=new BroadcastChannel('sb-workflow-test-auth-token');channel.postMessage({event:'TOKEN_REFRESHED',session:JSON.parse(localStorage.getItem('sb-workflow-test-auth-token'))});channel.close()})
 await renewed;assert.ok(await page.evaluate(()=>window.verifiedModel.isConnected),'same-user token refresh preserves verified settings')
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'locked'})))
 await page.waitForFunction(()=>!window.verifiedModel.isConnected)
 assert.equal(await page.getByRole('region',{name:'Business service model',exact:true}).getByRole('combobox').count(),0,'lock invalidates defaults')
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'unlocked'})))
 await page.getByRole('region',{name:'Business service model',exact:true}).getByRole('combobox').waitFor()
 await page.evaluate(()=>{window.verifiedModel=document.querySelector('[aria-label="Business service model"]')})
 denyCapabilities=true
 await page.evaluate(()=>{const channel=new BroadcastChannel('sb-workflow-test-auth-token'),session=JSON.parse(localStorage.getItem('sb-workflow-test-auth-token'));session.user.id='99999999-9999-4999-8999-999999999999';channel.postMessage({event:'SIGNED_IN',session});channel.close()})
 await page.waitForFunction(()=>!window.verifiedModel.isConnected)
 assert.equal(await page.getByRole('region',{name:'Business service model',exact:true}).getByRole('combobox').count(),0,'identity changes discard old defaults')
 denyCapabilities=false
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'unlocked'})))
 await page.getByRole('region',{name:'Business service model',exact:true}).getByRole('combobox').waitFor()
 results.push({route:'/setup',state:'same-user token renewal preserves settings; lock and identity changes invalidate them',passed:true})
 const routes=[['/sessions','input[placeholder*="Search sessions"]'],['/team-management','input[placeholder*="Search"]'],['/team-management/invite','input[type=email]'],['/team-management/'+id,'input.rj-input.opacity-70'],['/setup/roles/'+id,'input.rj-input.opacity-70'],['/clients/'+child,'input[placeholder*="Search"]'],['/reviews','input[type=search]']]
 for(const width of [320,375,640,768,1280])for(const [route,selector]of routes){await page.setViewportSize({width,height:900});await page.goto(base+route);if(route.startsWith('/clients/'))await page.getByRole('button',{name:/Targets/}).first().click();const input=page.locator(selector).first();await input.waitFor();
 // Capability verification can replace the field between locator resolution and measurement.
 const measured=await page.waitForFunction(selector=>{const el=document.querySelector(selector);if(!el?.isConnected)return null;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.paddingLeft&&r.width?{padding:s.paddingLeft,type:el.type,disabled:el.disabled,fieldWidth:r.width,appearance:s.appearance}:null},selector)
 const styles=await measured.jsonValue();assert.equal(styles.padding,'16px',route+' ordinary inset');
 assert.equal(await input.evaluate(el=>{const r=el.getBoundingClientRect(),padding=parseFloat(getComputedStyle(el).paddingLeft);return [...el.parentElement.querySelectorAll('svg')].filter(svg=>!svg.closest('button')).some(svg=>{const b=svg.getBoundingClientRect();return b.width>0&&b.height>0&&b.right>r.left+padding&&b.left<r.right&&b.bottom>r.top&&b.top<r.bottom})}),false,route+' text region must be free of decorative overlays');
 if(route==='/sessions'){
  const dates=page.locator('input[type=datetime-local]');assert.equal(await dates.count(),2)
  for(const date of await dates.all()){assert.equal(await date.evaluate(el=>getComputedStyle(el).paddingLeft),'16px');await date.fill('2026-10-21T10:00');assert.equal(await date.inputValue(),'2026-10-21T10:00')}
  const status=page.locator('select').filter({has:page.locator('option[value=all]')}).last();await status.selectOption('scheduled');assert.equal(await status.inputValue(),'scheduled');await status.selectOption('all')
 }
 const empty=await input.inputValue();if(!styles.disabled){await input.fill('Synthetic long field value for layout verification');assert.equal(await input.inputValue(),'Synthetic long field value for layout verification');await input.fill(empty)}
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)console.log('overflow elements',await page.locator('main').evaluate(el=>[...el.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>innerWidth+2&&getComputedStyle(x).position!=='absolute').slice(-10).map(x=>({tag:x.tagName,class:x.className,text:x.textContent.slice(0,65),right:x.getBoundingClientRect().right}))));results.push({route,width,state:styles.disabled?'disabled populated':'empty and populated',...styles,overflow});
 if(width===375||width===1280)await page.screenshot({path:'work/form-field-evidence/'+route.replace(/\W/g,'_')+'-'+width+'.png',fullPage:true});console.log('checked',route,width,'overflow',overflow)
 }
 // Broad default-state rendering inventory. Dynamic record workflows need richer fixtures.
 const inventory=['/','/login','/staff-login','/set-pin','/onboarding','/onboarding-owner','/request-access','/children','/teachers','/dashboard','/attendance','/tasks','/my-sessions','/my-sessions/history','/team-management/import','/team-management/care-setup','/clients','/setup','/setup/preferences','/setup/appearance','/setup/care-teams','/setup/roles','/operations','/reports','/profile','/billing','/access-requests']
 await page.setViewportSize({width:375,height:900})
 for(const route of inventory){await page.goto(base+route);await page.waitForTimeout(200);const headings=await page.locator('h1').allTextContents();const fields=await page.locator('input:visible,textarea:visible,select:visible').count();results.push({route,width:375,state:'default rendering smoke only',destination:new URL(page.url()).pathname,headings,fields});console.log('smoke',route,headings.join(';'))}
 // Render shared primitives with the real production CSS, without business actions.
 await page.evaluate(()=>{const node=document.createElement('section');node.dataset.feedbackFixture='true';node.style.cssText='position:fixed;z-index:10000;inset:20px auto auto 20px;background:white;padding:20px;display:flex;gap:12px;flex-wrap:wrap';node.innerHTML='<button type="button" class="rj-button rj-button-primary">Feedback sample</button><button type="button" disabled class="rj-button rj-button-primary">Disabled sample</button><a href="#" class="rj-card rj-card-interactive" style="padding:16px">Card sample</a>';(document.querySelector('.rj-portal')||document.body).append(node)})
 const sample=page.getByRole('button',{name:'Feedback sample',exact:true}),disabled=page.getByRole('button',{name:'Disabled sample',exact:true})
 await page.emulateMedia({reducedMotion:'no-preference'});await sample.hover();await page.mouse.down();await page.waitForTimeout(160)
 assert.notEqual(await sample.evaluate(el=>getComputedStyle(el).transform),'none','enabled shared button has press feedback')
 await page.mouse.move(1,1);await page.mouse.up();await disabled.hover();await page.mouse.down();await page.waitForTimeout(160)
 assert.equal(await disabled.evaluate(el=>getComputedStyle(el).transform),'none','disabled button does not animate as enabled')
 await page.mouse.move(1,1);await page.mouse.up();await page.emulateMedia({reducedMotion:'reduce'});await sample.hover();await page.mouse.down();await page.waitForTimeout(30)
 assert.equal(await sample.evaluate(el=>getComputedStyle(el).transform),'none','reduced motion removes press movement')
 await page.mouse.move(1,1);await page.mouse.up();await sample.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
 assert.ok(await sample.evaluate(el=>el.matches(':focus-visible')&&parseFloat(getComputedStyle(el).outlineWidth)>=3),'keyboard focus remains visible with reduced motion')
 const color=await sample.evaluate(el=>getComputedStyle(el).backgroundColor)
 assert.ok(color.length>0)
 await page.evaluate(()=>document.querySelector('[data-feedback-fixture]').remove());await page.emulateMedia({reducedMotion:'no-preference'})
 results.push({route:'shared UI primitives',state:'press, disabled, reduced-motion and keyboard focus feedback',passed:true})
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(unknown,[]);assert.ok(results.filter(row=>row.state!=='default rendering smoke only').every(row=>!row.overflow),'Affected routes must fit each viewport')
 }finally{fs.writeFileSync('work/form-field-evidence/results.json',JSON.stringify({results,errors,blocked,unknown:[...new Set(unknown)]},null,2));await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1})
