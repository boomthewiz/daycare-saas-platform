/* eslint-disable @typescript-eslint/no-require-imports -- Standalone synthetic browser integration runner. */
// Browser -> intercepted HTTP RPC -> isolated PostgreSQL with real migrations/RLS.
// Start Next with NEXT_PUBLIC_SUPABASE_URL=https://workflow-test.supabase.co and a synthetic key.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createDatabase, ids } = require('./client-program.fixture.cjs')
const base=process.env.TEST_BASE_URL || 'http://localhost:3047'
;(async()=>{
  const db=await createDatabase()
  const browser=await chromium.launch({channel:'msedge',headless:true})
  let page, queue=Promise.resolve(), failReport=false, reportCalls=0, writes=0, heldReport=null
  const browserErrors=[]
  let phase="setup"
  const watchdog=setInterval(()=>console.log(JSON.stringify({phase,reportCalls,writes,url:page?.url()})),15000);watchdog.unref()
  try {
    await db.exec(`RESET ROLE; ALTER TABLE auth.users ADD COLUMN invited_at timestamptz, ADD COLUMN email_confirmed_at timestamptz, ADD COLUMN banned_until timestamptz;
      UPDATE auth.users SET email_confirmed_at=now(); UPDATE public.clients SET first_name='=Synthetic formula' WHERE id='${ids.client}';
      INSERT INTO public.clients(organization_id,first_name,status) SELECT '${ids.org}','Roster '||n,'active' FROM generate_series(1,103) n;`)
    for(const name of ['20261008061322_onboarding_progress.sql','20261017192817_daycare_operational_reports.sql','20261017192818_correct_canceled_onboarding_milestone.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'))
    await db.exec('SET ROLE authenticated')
    const user={id:ids.owner,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
    const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:ids.owner,session_id:ids.device,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.synthetic'
    const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true})
    await context.addInitScript(({token,user})=>{if(!localStorage.getItem('sb-workflow-test-auth-token')) localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,token_type:'bearer',user}))},{token,user})
    await context.route('**/*', route=>{
      const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').pop()
      if(url.origin===new URL(base).origin) {
        if(url.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}})
        if(url.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}})
        if(url.pathname.startsWith('/api/')) { writes++; return route.fulfill({status:403,json:{error:'Unexpected mutation denied by fixture'}}) }
        return route.continue()
      }
      if(url.origin!=='https://workflow-test.supabase.co') return route.abort()
      queue=queue.then(async()=>{
        let data=[]
        const body=request.postData()?request.postDataJSON():{}
        try {
          if(url.pathname==='/auth/v1/user')data=user
          else if(url.pathname.includes('/rpc/')) {
            const args={effective_capabilities:[],onboarding_progress:['p_include_staff'],operational_report:['p_report','p_from','p_to','p_branch','p_status','p_search','p_page'],set_reporting_timezone:['p_timezone'],subscription_access:['p_session_id'],current_organization_id:[],can_manage_clients:[],can_manage_users:[],can_manage_sessions:[],care_context:['p_client_id']}
            if(!Object.hasOwn(args,name))throw new Error(`Unexpected RPC ${name}`)
            if(name==='operational_report'){
              reportCalls++
              if(failReport){failReport=false;return route.fulfill({status:503,json:{message:'Synthetic report interruption. Retry.'}})}
              if(heldReport){const held=heldReport;heldReport=null;held.started();await held.wait}
            }
            if(name==='set_reporting_timezone')writes++
            const keys=args[name]
            data=(await db.query(`SELECT public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) value`,keys.map(key=>body[key]??null))).rows[0].value
          } else {
            const tables=['clients','users','organization_locations','organization_terminology','sessions','session_types','organizations','user_permissions','target_categories']
            if(!tables.includes(name))throw new Error(`Unexpected table ${name}`)
            if(request.method()!=='GET'){writes++;throw new Error('Business mutation denied by fixture')}
            data=(await db.query(`SELECT ${name==='users'?'id,organization_id,full_name,email,role,status':'*'} FROM public.${name}`)).rows
            for(const [key,value] of url.searchParams) if(value.startsWith('eq.'))data=data.filter(row=>String(row[key])===value.slice(3))
            if(name==='clients')for(const row of data)row.client_locations=[]
            if((request.headers().accept||'').includes('vnd.pgrst.object')) data=data[0]||null
          }
          await route.fulfill({json:data})
        }catch(cause){if(!cause.code)browserErrors.push(cause.message);await route.fulfill({status:400,json:{message:cause.message,code:cause.code||'FIXTURE'}})}
      })
      return queue
    })
    page=await context.newPage(); page.setDefaultTimeout(30000)
    page.on('pageerror',error=>browserErrors.push(error.message))
    phase='open-reports'; await page.goto(base+'/reports')
    await page.getByRole('heading',{name:'Reports',exact:true}).waitFor({timeout:90000})
    const library=page.getByRole('region',{name:'Report library'})
    assert.equal(await library.getByRole('button').count(),3)
    assert.equal(reportCalls,0,'no report automatically runs')
    await page.getByRole('button',{name:'Start walkthrough',exact:true}).click()
    const coach=page.getByRole('region',{name:'Page walkthrough'})
    await coach.getByText('Step 1 of 6').waitFor()
    await coach.getByRole('button',{name:'Next',exact:true}).click()
    await coach.getByText('Step 2 of 6').waitFor()
    await coach.getByRole('button',{name:'Back',exact:true}).click()
    await coach.getByText('Step 1 of 6').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await coach.count(),0)
    await page.reload(); await page.getByRole('button',{name:'Resume walkthrough',exact:true}).click()
    await coach.getByText('Step 1 of 6').waitFor()
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'locked'})))
    await coach.waitFor({state:'detached'})
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'unlocked'})))
    await page.getByRole('button',{name:'Run report',exact:true}).waitFor()
    assert.equal(writes,0,'teaching does not mutate business data')
    phase='query-and-export'; failReport=true
    await page.getByRole('button',{name:'Run report',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Synthetic report interruption'}).waitFor()
    await page.getByRole('button',{name:'Run report',exact:true}).click()
    await page.getByText(/Page 1 · 100 records/).waitFor()
    assert.ok(!(await page.getByRole('table').innerText()).includes('Foreign client'))
    const beforeExport=reportCalls
    phase='export'; const download=page.waitForEvent('download')
    await page.getByRole('button',{name:'Export this page as CSV'}).click()
    const csv=fs.readFileSync(await (await download).path(),'utf8')
    assert.ok(csv.includes("'=Synthetic formula")); assert.ok(csv.includes('Current snapshot')); assert.equal(reportCalls,beforeExport+1)
    let releaseHeld,markStarted,lateDownloads=0
    const started=new Promise(resolve=>{markStarted=resolve})
    heldReport={started:markStarted,wait:new Promise(resolve=>{releaseHeld=resolve})}
    const lateDownload=()=>{lateDownloads++}
    page.on('download',lateDownload)
    await page.getByRole('button',{name:'Export this page as CSV'}).click()
    await started
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'locked'})))
    releaseHeld(); await queue
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rejoyce:device-state',{detail:'unlocked'})))
    await page.getByRole('button',{name:'Run report',exact:true}).waitFor()
    assert.equal(lateDownloads,0,'a late export response must not download after device lock')
    page.off('download',lateDownload)
    await page.getByRole('button',{name:'Run report',exact:true}).click()
    await page.getByText(/Page 1 · 100 records/).waitFor()
    await page.getByRole('button',{name:'Next page',exact:true}).click()
    await page.getByText(/Page 2 · 5 records/).waitFor()
    phase='staff-report'; await library.getByRole('button',{name:/D2/}).click()
    await page.getByRole('button',{name:'Run report',exact:true}).click()
    await page.getByRole('columnheader',{name:'PIN ready',exact:true}).waitFor()
    phase='schedule-report'; await library.getByRole('button',{name:/D3/}).click()
    assert.equal(await page.getByRole('button',{name:'Run report',exact:true}).isDisabled(),true)
    await page.getByText('Configure reporting timezone',{exact:true}).click()
    await page.getByLabel('IANA timezone',{exact:true}).fill('America/Chicago')
    await page.getByRole('button',{name:'Save reporting timezone',exact:true}).click()
    await page.getByLabel('From local date',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Run report',exact:true}).click()
    await page.getByRole('columnheader',{name:'Activity type',exact:true}).waitFor()
    phase='mobile'; await page.setViewportSize({width:390,height:844})
    await page.getByRole('button',{name:'Resume walkthrough',exact:true}).click()
    await coach.waitFor()
    const dimensions=await coach.boundingBox(); assert.ok(dimensions.x>=0 && dimensions.x+dimensions.width<=390)
    await coach.getByRole('button',{name:'Pause',exact:true}).click()
    if(process.env.TEST_SCREENSHOT_DIR) { fs.mkdirSync(process.env.TEST_SCREENSHOT_DIR,{recursive:true}); await page.screenshot({path:path.join(process.env.TEST_SCREENSHOT_DIR,'reports-mobile.png'),fullPage:true}) }
    phase='setup-tour'; await page.goto(base+'/setup')
    await page.getByRole('button',{name:'Start walkthrough',exact:true}).waitFor()
    await page.getByRole('button',{name:'Start walkthrough',exact:true}).click()
    await coach.getByRole('heading',{name:'Set up your everyday workspace'}).waitFor()
    await coach.getByRole('button',{name:'Pause',exact:true}).click()
    await page.goto(base+'/team-management?tab=team')
    await page.getByRole('button',{name:'Start walkthrough',exact:true}).waitFor()
    await page.getByRole('button',{name:'Start walkthrough',exact:true}).click()
    await coach.getByRole('heading',{name:'Review people for everyday work'}).waitFor()
    await coach.getByRole('button',{name:'Pause',exact:true}).click()
    await page.getByRole('status').filter({hasText:'Account status, invitation acceptance'}).waitFor()
    await page.goto(base+'/setup/preferences?tab=locations')
    await page.getByRole('button',{name:'Add Branch',exact:true}).waitFor()
    assert.equal(await page.getByRole('alert').filter({hasText:/\S/}).count(),0)
    assert.equal(writes,1,'only explicit timezone save mutated data')
    await queue
    await db.exec(`RESET ROLE;UPDATE public.users SET role='manager' WHERE id='${ids.owner}'; INSERT INTO public.user_permissions(user_id,organization_id,can_view_reports,can_manage_sessions) VALUES('${ids.owner}','${ids.org}',true,true);SET ROLE authenticated;`)
    phase='open-reports'; await page.goto(base+'/reports')
    await library.getByRole('button',{name:/D1/}).waitFor()
    assert.equal(await library.getByRole('button').count(),2,'staff report excluded without Manage users')
    assert.equal(await library.getByRole('button',{name:/D2/}).count(),0)
    assert.deepEqual(browserErrors,[])
    console.log(JSON.stringify({passed:true,reportCalls,explicitWrites:writes,csvFormulaProtected:true,tourReplayAndLockPause:true,mobileCoachFits:true,staffReportScoped:true}))
  } catch(cause){if(page)console.error((await page.locator('body').innerText()).slice(-5000));throw cause}
  finally {clearInterval(watchdog);await browser.close();await db.close()}
})().catch(cause=>{console.error(cause);process.exitCode=1})
