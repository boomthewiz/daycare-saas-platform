/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic browser-to-PostgreSQL integration runner. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {createFoundationsDatabase,ids,actor}=require('./helpers/daycare-foundations-db.cjs')
const base=process.env.TEST_BASE_URL||'http://localhost:3047'
;(async()=>{
 const db=await createFoundationsDatabase(),browser=await chromium.launch({channel:'msedge',headless:true})
 let page,queue=Promise.resolve(),failMutation=false,failReadiness=false
 const errors=[],calls=[]
 const inspect=sql=>{const task=queue.then(async()=>{await db.exec('RESET ROLE');try{return await db.query(sql)}finally{await db.exec('SET ROLE authenticated')}});queue=task.then(()=>{});return task}
 try{
  const user={id:ids.owner,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
  const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:ids.owner,session_id:ids.device,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.synthetic'
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true})
  await context.addInitScript(({user,token})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,token_type:'bearer',user})),{user,token})
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').pop()
   if(url.origin===new URL(base).origin){
    if(url.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}})
    if(url.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}})
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:403,json:{error:'No external side effects allowed in fixture'}})
    return route.continue()
   }
   if(url.origin!=='https://workflow-test.supabase.co')return route.abort()
   queue=queue.then(async()=>{
    try{
     let data=[];const body=request.postData()?request.postDataJSON():{}
     if(url.pathname==='/auth/v1/user')data=user
     else if(url.pathname.includes('/rpc/')){
      const args={effective_capabilities:[],current_organization_id:[],is_frontline_staff:[],can_review_sessions:[],can_manage_clients:[],can_manage_users:[],can_manage_sessions:[],subscription_access:['p_session_id'],session_people_readiness:[],attendance_context:[],attendance_activation:["p_user"],activity_schedule:["p_session"],create_scheduled_context_session:["p_child","p_provider","p_start","p_end","p_type","p_location","p_tags","p_operation","p_intent"],attendance_read:['p_branch','p_from','p_to','p_open','p_search','p_page','p_export'],attendance_mutate:['p_action','p_child','p_branch','p_visit','p_version','p_in','p_out','p_reason','p_operation'],attendance_history:['p_visit'],set_attendance_scope:['p_user','p_branches','p_expected'],session_context:['p_session'],save_session_choice:['p_kind','p_label','p_domain'],save_session_type_choice:['p_label','p_duration'],create_context_session:['p_child','p_provider','p_start','p_end','p_type','p_location','p_tags','p_operation']}
      if(!Object.hasOwn(args,name))throw new Error('Unexpected RPC '+name)
      calls.push({name,body})
      if(name==='attendance_activation'&&failReadiness){failReadiness=false;return route.fulfill({status:503,json:{message:'Synthetic readiness unavailable'}})}
      if(name==='attendance_mutate'&&failMutation){failMutation=false;return route.fulfill({status:503,json:{message:'Synthetic interrupted attendance save'}})}
      const keys=args[name];data=(await db.query(`SELECT public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) value`,keys.map(key=>body[key]??null))).rows[0].value
     }else{
      const tables=['clients','users','sessions','session_types','organization_locations','organization_terminology','organizations','user_permissions','session_notes','session_note_history','session_note_remarks']
      if(!tables.includes(name))throw new Error('Unexpected table '+name)
      if(request.method()==='PATCH'&&name==='sessions'){
       const fields=Object.keys(body),allowed=['scheduled_start','scheduled_end','location','status']
       if(fields.some(key=>!allowed.includes(key))||fields.length!==4)throw new Error('Unexpected activity edit fields')
       const id=url.searchParams.get('id')?.replace(/^eq\./,''),version=url.searchParams.get('updated_at')?.replace(/^eq\./,'')
       data=(await db.query(`UPDATE public.sessions SET ${fields.map((key,i)=>key+'=$'+(i+1)).join(',')} WHERE id=$5 AND updated_at=$6 AND workflow_intent='activity' RETURNING id`,[...fields.map(key=>body[key]),id,version])).rows
       return route.fulfill({json:data})
      }
      if(request.method()!=='GET')throw new Error('Unexpected direct table write')
      data=(await db.query(`SELECT ${name==='users'?'id,organization_id,full_name,email,role,status':'*'} FROM public.${name}`)).rows
      for(const [key,value] of url.searchParams){if(value.startsWith('eq.'))data=data.filter(row=>String(row[key])===value.slice(3));if(value.startsWith('in.('))data=data.filter(row=>value.slice(4,-1).split(',').includes(row[key]))}
      if(name==='sessions')for(const row of data){row.clients={first_name:'Synthetic destination',preferred_name:null};row.provider={full_name:'Synthetic staff'};row.session_targets=[]}
      if((request.headers().accept||'').includes('vnd.pgrst.object'))data=data[0]||null
     }
     await route.fulfill({json:data})
    }catch(cause){if(!cause.code)errors.push(cause.message);await route.fulfill({status:400,json:{message:cause.message,code:cause.code||'FIXTURE'}})}
   });return queue
  })
  page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message))
  await page.goto(base+'/attendance');await page.getByRole('heading',{name:'Attendance',exact:true}).waitFor({timeout:90000})
  await page.getByRole('region',{name:'Attendance activation checklist'}).getByText(/My recorder readiness — Ready/).waitFor()
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'locked'})))
  assert.equal(await page.getByRole('region',{name:'Attendance activation checklist'}).count(),0,'lock clears checklist')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'unlocked'})))
  await page.getByText(/My recorder readiness — Ready/).waitFor()
  failReadiness=true
  await page.getByRole('button',{name:'Refresh readiness',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Readiness unverified'}).waitFor()
  assert.equal(await page.getByText(/My recorder readiness — Ready/).count(),0,'failed verification never leaves a ready result')
  await page.getByRole('button',{name:'Refresh readiness',exact:true}).click()
  await page.getByText(/My recorder readiness — Ready/).waitFor()
  await page.getByLabel('Recorder to check').selectOption(ids.staff)
  await page.getByText(/Selected recorder: Synthetic staff — Not ready/).waitFor()
  await page.getByLabel('Recorder to check').selectOption('')
  await page.getByText(/My recorder readiness — Ready/).waitFor()
  await page.getByRole('button',{name:'Load visits and child choices',exact:true}).click()
  await page.getByLabel('Child for check-in').selectOption(ids.client)
  failMutation=true
  await page.getByRole('button',{name:'Confirm check-in now',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Synthetic interrupted attendance save'}).waitFor()
  assert.equal(await page.getByLabel('Child for check-in').inputValue(),ids.client)
  await page.getByRole('button',{name:'Confirm check-in now',exact:true}).click()
  await page.getByRole('button',{name:'Confirm check-out now',exact:true}).waitFor()
  const mutations=calls.filter(call=>call.name==='attendance_mutate')
  assert.equal(mutations[0].body.p_operation,mutations[1].body.p_operation,'retry reuses operation ID')
  await page.getByRole('button',{name:'History / correct',exact:true}).click()
  await page.getByLabel('Correction or void reason',{exact:true}).fill('Browser verified correction')
  await page.getByRole('button',{name:'Apply reasoned correction',exact:true}).click()
  await page.getByRole('button',{name:'Confirm check-out now',exact:true}).waitFor()
  await page.getByRole('button',{name:'Confirm check-out now',exact:true}).click()
  await page.getByLabel('All open visits, including older dates',{exact:true}).uncheck()
  await page.getByRole('button',{name:'Load visits and child choices',exact:true}).click()
  await page.getByRole('button',{name:'Export this page',exact:true}).waitFor()
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export this page',exact:true}).click()
  const csv=fs.readFileSync(await(await download).path(),'utf8');assert.ok(csv.includes('Not recorded'));assert.ok(!csv.includes('Browser verified correction'))
  await page.setViewportSize({width:390,height:844})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile attendance page should not overflow viewport')
  if(process.env.TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TEST_SCREENSHOT_DIR,'attendance-mobile.png'),fullPage:true})}
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/sessions')
  await page.getByLabel('Client',{exact:true}).waitFor()
  await page.getByLabel('Client',{exact:true}).fill('Synthetic destination');await page.getByRole('button',{name:'Synthetic destination',exact:true}).click()
  const providerLabel=await page.getByText('Assigned frontline worker',{exact:true}).count()?'Assigned frontline worker':'Assigned team member'
  await page.getByLabel(providerLabel,{exact:true}).fill('Synthetic staff');await page.getByRole('button',{name:'Synthetic staff',exact:true}).click()
  await page.getByLabel('Session type',{exact:true}).fill('Parent practice appointment')
  await page.getByRole('button',{name:'Create and save activity type: Parent practice appointment',exact:true}).click()
  await page.getByLabel('Start',{exact:true}).fill('2026-10-20T10:00');await page.getByLabel('End',{exact:true}).fill('2026-10-20T11:00')
  await page.getByLabel('Location',{exact:true}).fill('Family room')
  await page.getByRole('button',{name:'Create and save location choice: Family room',exact:true}).click()
  await page.getByLabel('New tag category').selectOption('aba')
  await page.getByLabel('Activity tag',{exact:true}).fill('Parent observed')
  assert.equal((await inspect('SELECT count(*)::integer n FROM rejoyce_security.session_choices WHERE kind=\'tag\'')).rows[0].n,0,'typing does not save a tag')
  await page.getByRole('button',{name:'Create and save tag: Parent observed',exact:true}).click()
  await page.getByRole('button',{name:'Create Session',exact:true}).click()
  await page.getByRole('heading',{name:'Session created successfully',exact:true}).waitFor()
  assert.equal((await inspect('SELECT count(*)::integer n FROM rejoyce_security.session_tags')).rows[0].n,1)
  const activityId=(await inspect("SELECT id FROM public.sessions WHERE workflow_intent='activity'")).rows[0].id
  assert.equal((await inspect("SELECT count(*)::integer n FROM public.session_targets WHERE session_id='"+activityId+"'")).rows[0].n,0)
  await page.goto(base+'/sessions/'+activityId)
  await page.getByRole('heading',{name:'Ordinary activity',exact:true}).waitFor()
  await page.getByText('No treatment targets, clinical execution or clinical note required.',{exact:false}).waitFor()
  assert.equal(await page.getByRole('button',{name:/Prepare targets/}).count(),0)
  await page.goto(base+'/sessions/'+activityId+'/edit')
  await page.getByLabel('Location',{exact:true}).fill('Updated activity room')
  await page.getByRole('button',{name:'Save activity schedule',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Activity schedule saved.'}).waitFor()
  assert.equal((await inspect("SELECT location FROM public.sessions WHERE id='"+activityId+"'")).rows[0].location,'Updated activity room')
  await page.setViewportSize({width:390,height:844})
  await page.goto(base+'/activity/'+activityId)
  await page.getByRole('heading',{name:'Ordinary activity',exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile activity fits viewport')
  await page.goto(base+'/session/'+activityId)
  await page.getByRole('paragraph').filter({hasText:/This is an ordinary activity. Open it from My sessions/}).waitFor()
  await page.goto(base+'/session/'+activityId+'/complete')
  await page.getByRole('alert').filter({hasText:'Ordinary activities do not have clinical notes or review.'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).count(),0)
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/sessions')
  await page.getByText('Reuse recent session details',{exact:true}).click()
  await page.getByRole('button',{name:/Use Synthetic destination/}).click()
  assert.ok((await page.getByLabel('Client',{exact:true}).inputValue()).includes('Synthetic destination'))
  assert.equal(await page.getByLabel('Start',{exact:true}).inputValue(),'','preset does not silently copy an old date')
  assert.equal(await page.getByLabel('Scheduling workflow').inputValue(),'activity')
  await page.getByLabel('Scheduling workflow').selectOption('clinical')
  await page.getByLabel('Start',{exact:true}).fill('2026-10-21T10:00');await page.getByLabel('End',{exact:true}).fill('2026-10-21T11:00')
  await page.getByRole('button',{name:'Create Session',exact:true}).click()
  await page.getByRole('heading',{name:'Session created successfully',exact:true}).waitFor()
  assert.equal((await inspect("SELECT count(*)::integer n FROM public.sessions WHERE workflow_intent='clinical'")).rows[0].n,2)
  assert.ok(calls.some(call=>call.name==='create_scheduled_context_session'&&call.body.p_intent==='clinical'))
  assert.ok(calls.some(call=>call.name==='create_scheduled_context_session'&&call.body.p_intent==='activity'))
  if(process.env.TEST_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.TEST_SCREENSHOT_DIR,'session-context-desktop.png'),fullPage:true})
  await queue;await db.exec(`RESET ROLE;UPDATE public.users SET role='teacher' WHERE id='${ids.owner}';UPDATE public.sessions SET provider_id='${ids.owner}' WHERE id='${ids.session}';`);await actor(db)
  await page.goto(base+'/attendance');await page.getByText('View attendance and separately assigned attendance branches are required.',{exact:false}).waitFor()
  assert.equal(await page.getByLabel('Child for check-in').count(),0,'clinical assignment alone exposes no attendance selector')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true,retriedOperationStable:true,correctionHistory:true,explicitCsv:true,parentTagSaved:true,searchableChoicesAndRecents:true,clinicalAssignmentDoesNotGrantAttendance:true,activityClinicalSeparation:true,activationChecklist:true,readinessRetry:true,mobileActivity:true}))
 }catch(cause){if(page)console.error((await page.locator('body').innerText()).slice(-6500));throw cause}
 finally{await browser.close();await db.close()}
})().catch(cause=>{console.error(cause);process.exitCode=1})
