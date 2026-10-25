/* eslint-disable @typescript-eslint/no-require-imports -- Browser to isolated PostgreSQL; all business HTTP intercepted. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const base=process.env.TEST_BASE_URL||'http://localhost:3047',extra='20000000-0000-4000-8000-000000000009'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
const activityDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10)
;(async()=>{const db=await createFoundationsDatabase(),browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});let queue=Promise.resolve();const errors=[],writes=[],evidence=[]
 const inspect=async sql=>{await queue;await db.exec('RESET ROLE');return db.query(sql)}
 try{
  await db.exec('RESET ROLE');await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../supabase/migrations/20261025012613_scheduling_timezone.sql'),'utf8'));await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../supabase/migrations/20261025020957_conflict_write_coverage.sql'),'utf8'));await actor(db);await db.query("SELECT public.set_scheduling_timezone($1,'America/Chicago',0)",[ids.org]);

  await db.exec(`RESET ROLE; INSERT INTO public.organization_terminology(organization_id,client_singular,client_plural,frontline_singular,frontline_plural,session_singular,session_plural) VALUES('${ids.org}','Child','Children','Educator','Educators','Activity','Activities'); INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES('${ids.org}','Outdoor play','outdoor_play',60);INSERT INTO auth.users(id,email) VALUES('${extra}','group@example.invalid');INSERT INTO public.users(id,organization_id,full_name,email,role,status,pin_hash,pin_reset_required) VALUES('${extra}','${ids.org}','Group worker','group@example.invalid','teacher','active','synthetic',false);INSERT INTO auth.sessions(id,user_id) VALUES('${extra}','${extra}');INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES('${extra}','${extra}',now(),now(),now()+interval '1 day');INSERT INTO public.client_locations(organization_id,client_id,location_id) VALUES('${ids.org}','${ids.sourceClient}','${ids.north}')`)
  async function openAs(userId,device){
   const user={id:userId,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
   const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,session_id:device,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.synthetic'
   const ctx=await browser.newContext({timezoneId:"Asia/Tokyo",viewport:{width:1280,height:900}})
   await ctx.addInitScript(({user,token})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,token_type:'bearer',user})),{user,token})
   await ctx.route('**/*',route=>{const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop();
    if(url.origin===new URL(base).origin){if(url.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}});if(url.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}});if(url.pathname.startsWith('/api/'))return route.fulfill({status:403,json:{error:'No real business actions in fixture'}});return route.continue()}
    if(url.origin!=='https://workflow-test.supabase.co')return route.abort()
    const args={scheduling_timezone:[],set_scheduling_timezone:["p_organization","p_timezone","p_version"],schedule_conflicts:["p_action","p_payload"],save_reviewed_schedule:["p_action","p_payload","p_review","p_ack"],account_service_model:[],set_account_service_model:["p_organization","p_model","p_version"],current_organization_id:[],effective_capabilities:[],subscription_access:['p_session_id'],can_manage_sessions:[],can_manage_clients:[],can_manage_users:[],can_review_sessions:[],is_frontline_staff:[],onboarding_progress:['p_staff'],session_people_readiness:[],session_context_v2:['p_session','p_selected','p_location'],search_session_choices:['p_kind','p_query','p_page','p_archived'],activity_class_context:[],save_activity_class:['p_id','p_version','p_name','p_branch','p_children','p_staff','p_active'],create_group_activity:['p_class','p_version','p_title','p_children','p_staff','p_start','p_end','p_type','p_location','p_operation'],list_group_activities:['p_from','p_to','p_branch','p_child','p_assigned','p_page'],activity_schedule:['p_session'],update_group_activity:['p_activity','p_version','p_start','p_end','p_location','p_status'],recover_session_creation:['p_operation','p_cancel']}
    queue=queue.then(async()=>{try{await actor(db,userId,device);let data=[];const body=req.postData()?req.postDataJSON():{};
     if(url.pathname==='/auth/v1/user')data=user
     else if(url.pathname.includes('/rpc/')){assert.ok(Object.hasOwn(args,name),'Unexpected RPC '+name);if(['save_activity_class','create_group_activity','update_group_activity','save_reviewed_schedule'].includes(name))writes.push(name);data=(await db.query(`SELECT public.${name}(${args[name].map((_,i)=>'$'+(i+1)).join(',')}) v`,args[name].map(key=>body[key]??null))).rows[0].v}
     else{assert.equal(req.method(),'GET','No direct table writes');assert.ok(['users','clients','sessions','session_types','organization_locations','organization_terminology','user_permissions','client_locations','client_targets','client_behaviors','target_categories','organizations','session_notes'].includes(name),'Unexpected table '+name);data=(await db.query(`SELECT ${name==='users'?'id,organization_id,full_name,email,role,status':'*'} FROM public.${name}`)).rows;for(const [key,value]of url.searchParams){if(value.startsWith('eq.'))data=data.filter(row=>String(row[key])===value.slice(3));if(value.startsWith('in.('))data=data.filter(row=>value.slice(4,-1).split(',').includes(row[key]))}if(name==='sessions')for(const row of data){row.clients={first_name:'Synthetic destination',preferred_name:null};row.provider={full_name:'Synthetic staff'};row.session_targets=[]}if((req.headers().accept||'').includes('vnd.pgrst.object'))data=data[0]||null}
     await route.fulfill({json:data})
    }catch(e){errors.push(e.message);await route.fulfill({status:400,json:{message:e.message}})}});return queue
   })
   const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));return {ctx,page}
  }
  const {ctx,page}=await openAs(ids.owner,ids.device)
  await page.goto(base+'/classes');await page.getByRole('heading',{name:'Classes',exact:true}).waitFor()
  await page.getByLabel('Class name',{exact:true}).fill('Preschool Blue');await page.getByLabel(/^Branch/).selectOption(ids.north)
  await page.getByLabel('Synthetic destination',{exact:true}).check();await page.getByLabel('Synthetic source',{exact:true}).check();await page.getByLabel('Synthetic staff',{exact:true}).check();await page.getByLabel('Group worker',{exact:true}).check()
  await page.getByRole('button',{name:'Save class',exact:true}).click();await page.getByRole('status').filter({hasText:'Class saved.'}).waitFor()
  const classId=(await inspect('SELECT id FROM rejoyce_security.activity_classes')).rows[0].id
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Classes fit '+width);evidence.push({route:'/classes',width,overflow:false})}
  await page.getByRole('link',{name:'Schedule activity for Preschool Blue',exact:true}).click()
  await page.getByRole('region',{name:'Group activity roster'}).waitFor();await page.getByRole('combobox',{name:/^Class/}).selectOption(classId)
  await page.getByLabel('Activity name',{exact:true}).fill('Outdoor play');await page.getByLabel(/^(Session type|Activity type)$/).fill('Outdoor');await page.getByRole('button',{name:/^Outdoor play/}).click();await page.locator('input[type=datetime-local]').first().fill(activityDate+'T10:00');await page.locator('input[type=datetime-local]').last().fill(activityDate+'T11:00')
  fs.mkdirSync('work/class-activity-evidence',{recursive:true});await page.screenshot({path:'work/class-activity-evidence/schedule-group-desktop.png',fullPage:true});await page.getByRole('button',{name:'Schedule Activity',exact:true}).click();await page.getByText('Activity scheduled. No clinical targets prepared; this is not recorded attendance.',{exact:true}).waitFor()
  const activityId=(await inspect('SELECT id FROM rejoyce_security.group_activities')).rows[0].id
  // A second overlapping ordinary Activity must be reviewed, not silently scheduled.
  await page.goto(base+'/sessions?intent=activity&start='+activityDate+'T10:00&end='+activityDate+'T11:00')
  await page.getByLabel(/^(Child|Client)$/).fill('Synthetic destination');await page.getByRole('button',{name:/^Synthetic destination/}).click()
  await page.getByLabel(/^Assigned /).fill('Synthetic staff');await page.getByRole('button',{name:/^Synthetic staff/}).click()
  await page.getByLabel('Activity type',{exact:true}).fill('Outdoor');await page.getByRole('button',{name:/^Outdoor play/}).click()
  await page.getByRole('button',{name:'Schedule Activity',exact:true}).click()
  const review=page.getByRole('dialog',{name:'Review overlapping work',exact:true});await review.waitFor()
  assert.ok(await review.getByRole('button',{name:'Acknowledge and continue'}).isDisabled())
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await review.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Conflict review fits '+width)}
  await page.screenshot({path:'work/class-activity-evidence/conflict-review-desktop.png',fullPage:false})
  await page.setViewportSize({width:375,height:900});await page.screenshot({path:'work/class-activity-evidence/conflict-review-mobile.png',fullPage:false})
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Schedule Activity'));assert.equal((await inspect("SELECT count(*)::int n FROM public.sessions WHERE workflow_intent='activity'")).rows[0].n,0,'cancel creates no Activity')
  await page.getByRole('button',{name:'Schedule Activity',exact:true}).click();await review.waitFor()
  await review.getByLabel('I reviewed the overlapping staff assignments').check();await review.getByLabel('I reviewed child overlaps and any planned pull-out').check();await review.getByLabel('Review reason',{exact:true}).fill('Planned class pull-out with reviewed staff responsibilities.')
  await review.getByRole('button',{name:'Acknowledge and continue'}).click();await page.getByRole('heading',{name:'Activity scheduled successfully',exact:true}).waitFor()
  assert.equal((await inspect('SELECT count(*)::int n FROM rejoyce_security.schedule_conflict_acknowledgements')).rows[0].n,1)
  await page.setViewportSize({width:1280,height:900})
  await page.goto(base+'/activity/'+activityId);await page.getByRole('heading',{name:'Group activity',exact:true}).waitFor();await page.getByText('Synthetic source',{exact:true}).waitFor()
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Group fits '+width);evidence.push({route:'/activity/group',width,overflow:false})}
  await page.goto(base+'/classes');await page.getByRole('button',{name:'Edit Preschool Blue',exact:true}).click();await page.getByLabel('Synthetic source',{exact:true}).uncheck();await page.getByRole('button',{name:'Save class',exact:true}).click();await page.getByRole('status').filter({hasText:'Class saved.'}).waitFor()
  await page.goto(base+'/activity/'+activityId);await page.getByText('Synthetic source',{exact:true}).waitFor()
  const assigned=await openAs(extra,extra);await assigned.page.goto(base+'/my-sessions');await assigned.page.getByRole('heading',{name:'Outdoor play',exact:true}).first().waitFor();await assigned.page.getByRole('link',{name:'View activity',exact:true}).first().click();await assigned.page.getByRole('heading',{name:'Group activity',exact:true}).waitFor()
  await page.goto(base+'/dashboard');await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await page.waitForFunction(()=>{const slot=document.querySelector('button[data-slot="18"]');return slot&&!slot.disabled});await page.getByLabel('Go to date',{exact:true}).fill(activityDate);await page.locator('a[href="/activity/'+activityId+'"]').first().waitFor();assert.equal(await page.locator('a[href="/activity/'+activityId+'"]').count(),1,'one group calendar event')
  await page.getByLabel('Schedule focus',{exact:true}).selectOption('classes')
  await page.locator('a[href="/activity/'+activityId+'"]').waitFor()
  await page.getByLabel('Schedule focus',{exact:true}).selectOption('sessions')
  assert.equal(await page.locator('a[href="/activity/'+activityId+'"]').count(),0,'individual view excludes group events')
  await page.getByLabel('Schedule focus',{exact:true}).selectOption('classes')
  await page.screenshot({path:'work/class-activity-evidence/calendar-classes.png',fullPage:true})
  await page.getByLabel('Calendar view',{exact:true}).selectOption('day')
  await page.waitForFunction(()=>!document.querySelector('button[data-slot="18"]')?.disabled)
  const slot=page.locator('button[data-day="0"][data-slot="18"]');await slot.scrollIntoViewIfNeeded()
  const box=await slot.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height*2.5,{steps:6});await page.mouse.up()
  await page.waitForURL(/\/sessions\?/)
  const draft=new URL(page.url());assert.equal(draft.searchParams.get('group'),'1');assert.equal(draft.searchParams.get('intent'),'activity');assert.equal(draft.searchParams.get('start'),activityDate+'T09:00');assert.equal(draft.searchParams.get('end'),activityDate+'T10:30')
  await page.getByRole('region',{name:'Group activity roster'}).waitFor()
  assert.equal(await page.locator('input[type=datetime-local]').last().inputValue(),activityDate+'T10:30','drag duration survives form load')
  // Service models change defaults only; saved clinical intent survives daycare vocabulary.
  const configure=async model=>{
   await page.goto(base+'/setup');const section=page.getByRole('region',{name:'Business service model',exact:true})
   await section.getByRole('combobox',{name:/^Service model/}).selectOption(model)
   await section.getByRole('button',{name:'Confirm service model',exact:true}).click()
   await section.getByRole('status').filter({hasText:'Service model saved.'}).waitFor()
  }
  await configure('daycare')
  await page.goto(base+'/dashboard');await page.getByLabel('Schedule focus',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#calendar-focus')?.value==='classes')
  assert.equal(await page.locator('#calendar-view').inputValue(),'auto')
  await page.goto(base+'/sessions');await page.waitForFunction(()=>document.querySelector('option[value="clinical"]')?.parentElement.value==='group')
  await configure('aba');await page.goto(base+'/sessions');await page.waitForFunction(()=>document.querySelector('option[value="clinical"]')?.parentElement.value==='clinical')
  await inspect(`UPDATE public.sessions SET scheduled_start='${activityDate}T20:00:00Z',scheduled_end='${activityDate}T21:00:00Z' WHERE id='${ids.session}'`); await inspect(`INSERT INTO public.sessions(id,organization_id,client_id,provider_id,session_type,workflow_intent,status,scheduled_start,scheduled_end) VALUES('80000000-0000-4000-8000-000000000001','${ids.org}','${ids.client}','${ids.staff}','direct_therapy','activity','scheduled','${activityDate}T21:00:00Z','${activityDate}T22:00:00Z')`)
  await configure('mixed');
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Service model settings fit '+width)}
  await page.screenshot({path:'work/class-activity-evidence/service-model-settings.png',fullPage:true})
  await page.goto(base+'/sessions');await page.getByLabel('Scheduling workflow').waitFor();assert.equal(await page.getByLabel('Scheduling workflow').inputValue(),'')
  await page.goto(base+'/dashboard');await page.waitForFunction(()=>{const slot=document.querySelector('button[data-slot="18"]');return slot&&!slot.disabled});await page.getByLabel('Go to date',{exact:true}).fill(activityDate);await page.getByLabel('Calendar view',{exact:true}).selectOption('day')
  await page.locator('a[href="/sessions/'+ids.session+'"]').waitFor()
  await page.getByLabel('Schedule focus',{exact:true}).selectOption('sessions')
  assert.ok(await page.locator('a[href="/sessions/'+ids.session+'"]').getByText('ABA session',{exact:true}).isVisible(),'clinical intent is not translated by daycare vocabulary')
  assert.equal(await page.locator('a[href="/sessions/80000000-0000-4000-8000-000000000001"]').count(),0,'ABA excludes individual Activity')
  assert.equal(await page.locator('a[href="/activity/'+activityId+'"]').count(),0,'ABA excludes group Activity')
  await page.getByLabel('Schedule focus',{exact:true}).selectOption('activities')
  assert.equal(await page.locator('a[href="/sessions/'+ids.session+'"]').count(),0,'Activities excludes clinical intent')
  assert.equal(await page.locator('a[href="/sessions/80000000-0000-4000-8000-000000000001"]').count(),1)
  assert.equal(await page.locator('a[href="/activity/'+activityId+'"]').count(),1)
  for(const [choice,intent,group]of [['ABA session','clinical',null],['Individual Activity','activity',null],['Group Activity','activity','1']]){
   await page.goto(base+'/dashboard');await page.waitForFunction(()=>{const slot=document.querySelector('button[data-slot="18"]');return slot&&!slot.disabled});await page.getByLabel('Go to date',{exact:true}).fill(activityDate);await page.getByLabel('Calendar view',{exact:true}).selectOption('day')
   await page.getByRole('button',{name:'Schedule work',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('button[data-slot="18"]')?.disabled)
   const time=page.locator('button[data-day="0"][data-slot="18"]');await time.scrollIntoViewIfNeeded();const rect=await time.boundingBox()
   await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height*2.5,{steps:6});await page.mouse.up()
   await page.getByRole('region',{name:'Choose scheduling type'}).getByRole('button',{name:choice,exact:true}).click();await page.waitForURL(/\/sessions\?/)
   const query=new URL(page.url()).searchParams;assert.equal(query.get('intent'),intent);assert.equal(query.get('group'),group);assert.equal(query.get('start'),activityDate+'T09:00');assert.equal(query.get('end'),activityDate+'T10:30')
   await page.getByLabel('Scheduling workflow').waitFor();assert.equal(await page.locator('input[type=datetime-local]').last().inputValue(),activityDate+'T10:30')
   await page.getByLabel('Scheduling workflow').selectOption('individual');assert.equal(await page.locator('input[type=datetime-local]').last().inputValue(),activityDate+'T10:30')
  }
  fs.mkdirSync('work/class-activity-evidence',{recursive:true});await assigned.page.setViewportSize({width:375,height:900});await assigned.page.screenshot({path:'work/class-activity-evidence/assigned-group-mobile.png',fullPage:true})
  await page.goto(base+'/classes');await page.getByRole('button',{name:'Edit Preschool Blue',exact:true}).click();await page.getByLabel('Class name',{exact:true}).waitFor();await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'work/class-activity-evidence/classes-desktop.png',fullPage:true})
  await page.goto(base+'/activity/'+activityId+'?edit=1');await page.getByRole('combobox',{name:/^Schedule status/}).selectOption('canceled');await page.getByRole('button',{name:'Save activity schedule',exact:true}).click();await page.getByRole('status').filter({hasText:'Activity schedule saved.'}).waitFor()
  await assigned.page.goto(base+'/my-sessions/history');await assigned.page.getByRole('heading',{name:'Canceled group activities',exact:true}).waitFor();await assigned.page.locator('a[href="/activity/'+activityId+'"]').waitFor()
  // A traveling device still schedules in Chicago, with an explicit repeated-time occurrence.
  await page.goto(base+'/sessions?intent=activity&start=2026-11-01T01:30&end=2026-11-01T02:30')
  await page.getByLabel(/^(Child|Client)$/).fill('Synthetic destination');await page.getByRole('button',{name:/^Synthetic destination/}).click()
  await page.getByLabel(/^Assigned /).fill('Synthetic staff');await page.getByRole('button',{name:/^Synthetic staff/}).click()
  await page.getByLabel('Activity type',{exact:true}).fill('Outdoor');await page.getByRole('button',{name:/^Outdoor play/}).click()
  const clockReview=page.getByRole('region',{name:'Schedule timezone review',exact:true})
  await clockReview.getByLabel('Start clock-change occurrence').selectOption('2026-11-01T07:30:00.000Z')
  await page.getByRole('button',{name:'Schedule Activity',exact:true}).click()
  await page.getByText('Activity scheduled. No clinical targets prepared; this is not recorded attendance.',{exact:true}).waitFor()
  const folded=await inspect("SELECT scheduled_start::text start FROM public.sessions WHERE scheduled_start='2026-11-01T07:30Z'");assert.equal(folded.rows.length,1,'selected later occurrence saved from Tokyo device')
  await page.goto(base+'/sessions?intent=activity&start=2026-03-08T02:30&end=2026-03-08T03:30')
  await page.getByRole('region',{name:'Schedule timezone review',exact:true}).getByText(/does not exist/).waitFor()
  assert.equal(await page.locator('input[type=datetime-local]').first().inputValue(),'2026-03-08T02:30','gap is never normalized by the device')
  await page.goto(base+'/sessions?intent=activity&start=2026-11-02T09:00&end=2026-11-02T10:00')
  await page.getByRole('region',{name:'Schedule timezone review',exact:true}).getByText(/America\/Chicago/).first().waitFor()
  const settingsPage=await ctx.newPage();await settingsPage.goto(base+'/setup')
  const settings=settingsPage.getByRole('region',{name:'Organization scheduling timezone',exact:true})
  await settings.getByLabel('IANA scheduling timezone',{exact:true}).fill('Asia/Tokyo')
  await settings.getByRole('button',{name:'Review timezone change',exact:true}).click()
  await settings.getByRole('button',{name:'Confirm scheduling timezone',exact:true}).click()
  await settings.getByText('Scheduling timezone saved. Existing booking instants were preserved.',{exact:true}).waitFor()
  await settingsPage.setViewportSize({width:320,height:900});assert.ok(await settingsPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'timezone settings fit mobile')
  await settingsPage.screenshot({path:'work/class-activity-evidence/timezone-settings-mobile.png',fullPage:true})
  await settingsPage.close()
  await page.evaluate(()=>window.dispatchEvent(new Event('rejoyce:scheduling-timezone-changed')))
  await page.getByText('Scheduling timezone changed. Reload this page and review times before saving.',{exact:false}).first().waitFor()
  assert.equal(await page.locator('input[type=datetime-local]').first().inputValue(),'2026-11-02T09:00','remote timezone change preserves draft wall time')
  assert.ok(await page.getByRole('button',{name:'Schedule Activity',exact:true}).isDisabled())
  await queue;assert.deepEqual(errors,[]);assert.ok(writes.includes('save_reviewed_schedule'));fs.writeFileSync('work/class-activity-evidence/results.json',JSON.stringify({passed:true,evidence,rosterSnapshot:true,secondaryStaffAccess:true,writes},null,2));console.log(JSON.stringify({passed:true,evidence,rosterSnapshot:true,secondaryStaffAccess:true}))
  await assigned.ctx.close();await ctx.close()
 }finally{await browser.close();await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
