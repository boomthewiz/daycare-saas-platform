// Browser interaction regression. Run against a local server configured with the
// synthetic Supabase URL below; all API responses are mocked, never production.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3017'
const sessionId='11111111-1111-4111-8111-111111111111'
const userId='22222222-2222-4222-8222-222222222222'
const stamp='2026-09-23T12:00:00Z'
let role='teacher', sessionStatus='in_progress', note=null, failOnce=false, failRefresh=false, history=[],remarks=[],requestIds=[]
const user={id:userId,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.synthetic'
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 let page
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}})
  await context.addInitScript(({token,user})=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})),{token,user})
  await context.route('**/api/session-policy',route=>route.fulfill({json:{enabled:false}}))
  await context.route('**/api/pin-status',route=>route.fulfill({json:{hasPin:true,resetRequired:false}}))
  await context.route('https://workflow-test.supabase.co/**',async route=>{
   const url=new URL(route.request().url()), path=url.pathname
   let data=[]
   if(path==='/auth/v1/user') data=user
   else if(path.endsWith('/rpc/is_frontline_staff')) data=role==='teacher'
   else if(path.endsWith('/rpc/can_review_sessions')) data=role==='manager'||role==='owner'
   else if(path.endsWith('/rpc/mutate_session_note')) {
    const body=route.request().postDataJSON();requestIds.push(body.p_operation_id)
    if(failOnce){failOnce=false;await route.fulfill({status:503,json:{message:'Synthetic connection interruption'}});return}
    note={...note,id:sessionId,session_id:sessionId,author_id:userId,version:(note?.version||0)+1,created_at:note?.created_at||stamp,updated_at:stamp,
      status:body.p_action==='submit'?'submitted':body.p_action==='return'?'returned':body.p_action==='approve'?'approved':body.p_action==='lock'?'locked':body.p_action==='unlock'?note.locked_from_status:body.p_action==='revert_approval'?'submitted':note?.status||'draft',
      final_note:body.p_final_note??note?.final_note,therapist_addendum:body.p_addendum??note?.therapist_addendum,
      review_notes:body.p_action==='return'?body.p_feedback:note?.review_notes,
      locked_from_status:body.p_action==='lock'?note.status:note?.locked_from_status}
    history.unshift({id:String(history.length),actor_name:'Synthetic actor',action:body.p_action,occurred_at:stamp,snapshot:{...note}})
    data=note
   } else if(path.endsWith('/rpc/append_session_note_remark')) {
    const body=route.request().postDataJSON();data={id:'remark',author_name:'Synthetic admin',body:body.p_body,created_at:stamp};remarks.push(data)
   } else if(path.endsWith('/rpc/record_behavior_event')) {await route.fulfill({status:503,json:{message:'Synthetic collection failure'}});return}
   else if(path.endsWith('/sessions')) {
    data={id:sessionId,client_id:sessionId,provider_id:userId,status:sessionStatus,session_type:'direct_therapy',scheduled_start:stamp,started_at:stamp,total_paused_seconds:0,completed_at:sessionStatus==='completed'?stamp:null,clients:{first_name:'Synthetic client',last_name:null,preferred_name:null},session_notes:note?{status:note.status}:null}
    if(url.searchParams.get('select')?.includes('session_notes(status)')) data=[data]
   }
   else if(path.endsWith('/clients')) data={id:sessionId,first_name:'Synthetic client',preferred_name:null}
   else if(path.endsWith('/session_targets')) data=[{id:sessionId,session_id:sessionId,title:'Synthetic target',status:'active',sort_order:0,target_type:'discrete_trial',response_mode:'independent_prompted_retry'}]
   else if(path.endsWith('/client_behaviors')) data=[{id:sessionId,client_id:sessionId,name:'Synthetic behavior',measurement_type:'frequency',active:true}]
   else if(path.endsWith('/session_notes')) data=note
   else if(path.endsWith('/users')) data={id:userId,role,status:'active',full_name:'Synthetic user'}
   else if(path.endsWith('/session_note_history')) {
    if(failRefresh){failRefresh=false;await route.fulfill({status:503,json:{message:'History unavailable'}});return}
    data=history
   } else if(path.endsWith('/session_note_remarks')) data=remarks
   else if(path.endsWith('/user_permissions')) data={can_review_sessions:role==='manager'}
   await route.fulfill({json:data})
  })
  page=await context.newPage()
  await page.goto(`${base}/session/${sessionId}/complete`)
  await page.getByRole('heading',{name:'Session documentation'}).waitFor({timeout:90000})
  assert.equal(await page.getByRole('button',{name:'Submit for review'}).count(),0)
  await page.getByLabel('Session observations',{exact:true}).fill('During-session observation')
  await page.getByLabel('Final note',{exact:true}).fill('Synthetic draft text')
  await page.getByText('Recorded session data',{exact:true}).click()
  await page.getByRole('button',{name:'Load recorded data'}).click()
  await page.getByRole('button',{name:'Use as note draft'}).waitFor()
  assert.equal(await page.getByLabel('Final note',{exact:true}).inputValue(),'Synthetic draft text','Loading recorded data must not overwrite work')
  failOnce=true
  await page.getByRole('button',{name:'Save draft',exact:true}).click()
  await page.getByRole('button',{name:'Retry last request'}).waitFor()
  assert.equal(await page.getByLabel('Final note',{exact:true}).inputValue(),'Synthetic draft text')
  await page.getByRole('button',{name:'Retry last request'}).click()
  await page.getByText('Change saved.',{exact:true}).waitFor()
  assert.equal(requestIds[0],requestIds[1],'Retry must reuse operation ID')
  sessionStatus='completed'
  await page.getByRole('button',{name:'Reload saved record'}).click()
  await page.getByRole('button',{name:'Submit for review'}).click()
  await page.getByText('Change saved.',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Final note',{exact:true}).getAttribute('readonly'),'')
  role='manager'
  await page.goto(`${base}/reviews/${sessionId}`)
  await page.getByRole('button',{name:'Return for correction'}).waitFor()
  await page.getByLabel('Review feedback (required to return)',{exact:true}).fill('Clarify the observation')
  await page.getByRole('button',{name:'Return for correction'}).click()
  await page.getByRole('heading',{name:'Reviewer feedback'}).waitFor()
  role='teacher'
  await page.goto(`${base}/session/${sessionId}/complete`)
  await page.getByRole('button',{name:'Save draft',exact:true}).waitFor()
  assert.equal(await page.getByText('Clarify the observation',{exact:true}).count()>=1,true)
  await page.getByLabel('Final note',{exact:true}).fill('Corrected synthetic note')
  await page.getByRole('button',{name:'Submit for review'}).click()
  await page.getByText('Change saved.',{exact:true}).waitFor()
  role='manager'
  await page.goto(`${base}/reviews/${sessionId}`)
  await page.getByRole('button',{name:'Approve note'}).click()
  await page.getByText('Change saved.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Revert approval'}).count(),0)
  await page.getByRole('button',{name:'Lock note'}).click()
  await page.getByText('Change saved.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Unlock note'}).count(),0)
  role='admin'
  await page.getByRole('button',{name:'Reload saved record'}).click()
  await page.getByRole('button',{name:'Unlock note'}).waitFor()
  const before=JSON.stringify(note)
  await page.getByLabel('Add a remark',{exact:true}).fill('Separate locked-note remark')
  failRefresh=true
  await page.getByRole('button',{name:'Append remark'}).click()
  await page.getByText('Remark appended. The note and its timestamps are unchanged.').waitFor()
  assert.equal(JSON.stringify(note),before)
  assert.equal(await page.getByRole('button',{name:'Retry last request'}).count(),0,'A failed refresh must not retry an already confirmed write')
  await page.getByRole('button',{name:'Reload saved record'}).click()
  await page.getByText('Separate locked-note remark',{exact:true}).waitFor()
  if(process.env.TEST_SCREENSHOT) await page.screenshot({path:process.env.TEST_SCREENSHOT,fullPage:true})
  await page.getByRole('button',{name:'Unlock note'}).click()
  await page.getByRole('button',{name:'Revert approval'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Return for correction'}).count(),0,'Admin without review grant cannot return')
  await page.getByRole('button',{name:'Revert approval'}).click()
  await page.getByText('Change saved.',{exact:true}).waitFor()
  role='teacher';sessionStatus='in_progress'
  await page.goto(`${base}/session/${sessionId}`)
  await page.getByRole('button',{name:'Record Synthetic behavior event',exact:true}).click()
  await page.getByRole('button',{name:'Refresh session data'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Record Synthetic behavior event',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'Refresh session data'}).click()
  await page.getByRole('button',{name:'Refresh session data'}).waitFor({state:'hidden'})
  assert.equal(await page.getByRole('button',{name:'Record Synthetic behavior event',exact:true}).isEnabled(),true)
  sessionStatus='completed'
  await page.goto(`${base}/my-sessions/history`)
  await page.getByRole('heading',{name:'Session history',exact:true}).waitFor()
  await page.getByRole('link',{name:/Synthetic client/}).waitFor()
  await page.getByRole('link',{name:/Synthetic client/}).click()
  await page.getByRole('heading',{name:'Session documentation'}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Provider note screen must fit the mobile viewport')
  console.log('PASS: mobile draft, completion gate, failed-save preservation, retry identity, provider correction, reviewer/admin controls, remarks, confirmed-write refresh failure, collection failure recovery, historical navigation')
 } catch(error) { if(page) console.error((await page.locator('body').innerText()).slice(0,7000)); throw error }
 finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
