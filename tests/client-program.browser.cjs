/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS regression runner. */
// Browser -> intercepted Supabase API -> isolated PostgreSQL with real RLS,
// CHECKs and RPCs. Run Next with https://workflow-test.supabase.co and a
// synthetic public key. No production requests or writes are made.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { createDatabase, ids } = require('./client-program.fixture.cjs')
const { RESPONSE_MODES } = require('./helpers/load-ts.cjs')('lib/client-program-options.ts')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3037'
;(async () => {
  const db = await createDatabase()
  const browser = await chromium.launch({channel:'msedge',headless:true})
  let page, failApply = false, queue = Promise.resolve(), createdSession
  const writes = [], errors = []
  const user = {id:ids.owner,aud:'authenticated',role:'authenticated',email:'owner@example.invalid',app_metadata:{},user_metadata:{}}
  const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:ids.owner,session_id:ids.device,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.synthetic'
  try {
    const context = await browser.newContext({viewport:{width:1280,height:900}})
    await context.addInitScript(({token,user}) => localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})), {token,user})
    await context.route('**/api/session-policy', route => route.fulfill({json:{enabled:false}}))
    await context.route('**/api/pin-status', route => route.fulfill({json:{hasPin:true,resetRequired:false}}))
    await context.route('https://workflow-test.supabase.co/**', route => {
      queue = queue.then(async () => {
        const request = route.request(), url = new URL(request.url()), name = url.pathname.split('/').pop()
        const body = request.postData() ? request.postDataJSON() : {}
        let data = []
        try {
          if (url.pathname === '/auth/v1/user') data = user
          else if (url.pathname.includes('/rpc/')) {
            if (name === 'subscription_access') data = {managed:false,canWrite:true,canFinishSession:true,serverNow:new Date().toISOString()}
            else if (name === 'apply_client_behavior') {
              writes.push({name,body})
              if (failApply) { failApply=false; return route.fulfill({status:503,json:{message:'Synthetic interrupted request'}}) }
              data = (await db.query('SELECT public.apply_client_behavior($1,$2) value',[body.p_client_id,body.p_source_behavior_id])).rows[0].value
            } else if (name === 'create_prepared_session') {
              data = (await db.query('SELECT public.create_prepared_session($1,$2,$3,$4,$5,$6) value',[body.requested_client_id,body.requested_provider_id,body.requested_scheduled_start,body.requested_scheduled_end,body.requested_session_type,body.requested_location])).rows[0].value
              createdSession = data.session_id
            } else if (['can_manage_clients','can_manage_sessions','can_manage_users','can_review_sessions','is_frontline_staff','current_organization_id'].includes(name)) data = (await db.query(`SELECT public.${name}() value`)).rows[0].value
            else if (name === 'care_context') data = (await db.query('SELECT public.care_context($1) value',[body.p_client_id])).rows[0].value
            else data = false
          } else {
            const tables = ['clients','client_behaviors','client_targets','users','user_permissions','sessions','session_targets','target_responses','behavior_events','session_notes','session_types','organization_locations','client_locations','organization_terminology','organizations']
            if (tables.includes(name)) {
              if (request.method() === 'POST') {
                assert.equal(name,'client_targets')
                const keys=Object.keys(body)
                assert.ok(keys.every(key=>['organization_id','client_id','title','instruction','category','target_type','response_mode','materials','sort_order','status'].includes(key)))
                writes.push({name,body})
                await db.query(`INSERT INTO public.client_targets(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`, keys.map(key=>body[key]))
                return route.fulfill({status:201,json:null})
              }
              data = (await db.query(`SELECT ${name==='users'?'id,organization_id,email,full_name,role,status':'*'} FROM public.${name}`)).rows
              for (const [key,value] of url.searchParams) {
                if (value.startsWith('eq.')) data=data.filter(row=>String(row[key])===value.slice(3))
                if (value.startsWith('in.(')) data=data.filter(row=>value.slice(4,-1).split(',').includes(row[key]))
              }
              if (name === 'sessions') for (const row of data) {
                row.clients=(await db.query('SELECT first_name,last_name,preferred_name FROM public.clients WHERE id=$1',[row.client_id])).rows[0]
                row.provider={full_name:'Synthetic staff'}
                row.session_targets=(await db.query('SELECT id FROM public.session_targets WHERE session_id=$1',[row.id])).rows
              }
              if ((request.headers().accept||'').includes('vnd.pgrst.object')) data=data[0]||null
            }
          }
          await route.fulfill({json:data})
        } catch (cause) {
          errors.push(`${name}: ${cause.message}`)
          await route.fulfill({status:400,json:{message:cause.message,code:cause.code||'FIXTURE'}})
        }
      })
      return queue
    })
    page = await context.newPage()
    await page.goto(`${base}/clients/${ids.client}`)
    await page.getByRole('heading',{name:'Synthetic destination',exact:true}).waitFor({timeout:90000})
    await page.getByRole('button',{name:/^Behaviors/}).click()
    const picker = page.getByLabel('Select an existing behavior')
    await picker.waitFor()
    assert.ok(!(await picker.innerText()).includes('Foreign behavior'))
    await picker.selectOption(ids.source)
    failApply=true
    await page.getByRole('button',{name:'Apply Behavior',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Synthetic interrupted request'}).waitFor()
    assert.equal(await picker.inputValue(),ids.source,'Failed request retains selection')
    await page.getByRole('button',{name:'Apply Behavior',exact:true}).click()
    await page.getByRole('status').filter({hasText:'Behavior applied'}).waitFor()
    assert.equal((await db.query('SELECT count(*)::int n FROM public.client_behaviors WHERE client_id=$1',[ids.client])).rows[0].n,1)
    await page.reload()
    await page.getByRole('button',{name:/^Behaviors/}).click()
    await picker.waitFor()
    await page.waitForFunction(()=>document.querySelector('#reusable-behavior')?.textContent.includes('already added'))
    assert.equal(await picker.locator('option').filter({hasText:'already added'}).isDisabled(),true)
    await page.getByRole('button',{name:/^Targets/}).click()
    for (const mode of RESPONSE_MODES) {
      await page.getByRole('button',{name:'Add Target',exact:true}).first().click()
      await page.getByLabel('Target title',{exact:true}).fill(`Browser ${mode.value}`)
      assert.equal(await page.getByLabel(/^Target type/).inputValue(),'discrete_trial')
      assert.equal(await page.getByLabel(/^Response format/).inputValue(),'independent_prompted_retry')
      await page.getByLabel(/^Response format/).selectOption(mode.value)
      await page.getByRole('button',{name:'Create Target',exact:true}).click()
      await page.getByText('Target created successfully.',{exact:true}).waitFor()
      await page.getByRole('heading',{name:`Browser ${mode.value}`,exact:true}).waitFor()
    }
    await page.getByRole('link',{name:'Create Session',exact:true}).click()
    await page.getByLabel(/^Assigned team member/).selectOption(ids.staff)
    await page.getByLabel(/^Session type/).selectOption('direct_therapy')
    await page.getByLabel('Start',{exact:true}).fill('2026-10-13T10:00')
    await page.getByLabel('End',{exact:true}).fill('2026-10-13T11:00')
    await page.getByRole('button',{name:'Create Session',exact:true}).click()
    await page.getByRole('heading',{name:'Session created successfully',exact:true}).waitFor()
    assert.ok(createdSession,'Session was created through the real RPC')
    const targets = (await db.query('SELECT response_mode FROM public.session_targets WHERE session_id=$1',[createdSession])).rows
    assert.deepEqual(targets.map(row=>row.response_mode).sort(),RESPONSE_MODES.map(mode=>mode.value).sort())
    assert.equal((await db.query('SELECT count(*)::int n FROM public.client_behaviors WHERE client_id=$1 AND active',[ids.client])).rows[0].n,1)
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({passed:true,responseModes:targets.length,behaviorAssignments:1,duplicateOptionDisabled:true,retrySelectionRetained:true,createdSession,writes:writes.length}))
  } catch(cause) {
    console.error(errors)
    if (page) console.error((await page.locator('body').innerText()).slice(-6500))
    throw cause
  } finally { await browser.close(); await db.close() }
})().catch(cause=>{console.error(cause);process.exitCode=1})
