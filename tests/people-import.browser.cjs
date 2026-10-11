/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic browser harness. */
// Run against a loopback Next server. All API/Auth/data requests are intercepted;
// no invitation, credential, or person is sent to an external service.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3047'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const envFile = ['.env.local', '.env'].find(file => fs.existsSync(file))
const sourceUrl = process.env.TEST_SUPABASE_URL || (envFile && fs.readFileSync(envFile,'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=["']?([^\s"']+)/m)?.[1])
assert.ok(sourceUrl, 'Set TEST_SUPABASE_URL to the URL compiled into the local build')
const org = '22222222-2222-4222-8222-222222222222'
const user = { id:'11111111-1111-4111-8111-111111111111', aud:'authenticated', role:'authenticated', email:'synthetic@example.invalid', app_metadata:{}, user_metadata:{} }
const token = Buffer.from('{"alg":"HS256"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url') + '.synthetic'
const session = { access_token:token, refresh_token:'synthetic', expires_at:Math.floor(Date.now()/1000)+36000, expires_in:36000, token_type:'bearer', user }
;(async()=>{
  const browser = await chromium.launch({channel:'chrome',headless:true})
  const context = await browser.newContext({viewport:{width:390,height:844}})
  const errors=[], calls=[], existing=new Set(), evidence=[]
  let denied=false, readonly=false, currentOrg=org, failInvitation=true
  try {
    await context.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)), {key:`sb-${new URL(sourceUrl).hostname.split('.')[0]}-auth-token`,session})
    await context.route('**/*', async route=>{
      const request=route.request(), url=new URL(request.url()), name=url.pathname.split('/').pop()
      if(url.origin===base){
        if(url.pathname==='/api/pin-status')return route.fulfill({json:{hasPin:true,resetRequired:false}})
        if(url.pathname==='/api/session-policy')return route.fulfill({json:{enabled:false}})
        if(url.pathname==='/api/invite-user'){
          const body=request.postDataJSON();calls.push(body)
          assert.equal(body.organizationId,org)
          assert.match(body.email, /@example\.invalid$/)
          if(failInvitation){failInvitation=false;return route.fulfill({status:503,json:{error:'Synthetic timeout'}})}
          return route.fulfill({json:{invited:true,user_id:'synthetic-new-account'}})
        }
        if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}})
        return route.continue()
      }
      if(url.origin!==new URL(sourceUrl).origin)return route.abort()
      let data=[]
      const singular=(request.headers().accept||'').includes('vnd.pgrst.object')
      if(name==='user')data=user
      if(name==='users')data=singular?{...user,full_name:'Synthetic Owner',organization_id:org,role:'owner',status:'active'}:[]
      if(name==='organization_terminology')data={client_plural:'Students',client_singular:'Student',frontline_plural:'Teachers',frontline_singular:'Teacher',session_plural:'Lessons',session_singular:'Lesson'}
      if(name==='organization_locations')data=[{id:'north',name:'North',active:true},{id:'inactive',name:'Retired',active:false}]
      if(name==='current_organization_id')data=currentOrg
      if(name==='subscription_access')data={canWrite:!readonly,canFinishSession:true,managed:false}
      if(name.startsWith('can_'))data=!denied
      if(name==='clients'){
        assert.equal(url.searchParams.get('organization_id'),`eq.${org}`)
        data=[...existing].map(import_external_id=>({import_external_id}))
      }
      if(name==='import_clients'){
        assert.ok(!denied&&!readonly)
        const body=request.postDataJSON();calls.push(body)
        assert.equal(body.p_location_id,'north')
        data=body.p_rows.map(row=>{const status=existing.has(row.external_id)?'skipped':'created';existing.add(row.external_id);return {external_id:row.external_id,status}})
      }
      return route.fulfill({json:data})
    })
    const page=await context.newPage()
    page.on('pageerror',error=>errors.push(error.message))
    page.setDefaultTimeout(10000)
    const open=async()=>{await page.goto(base+'/team-management/import');await page.getByRole('heading',{name:'Import people',exact:true}).waitFor()}
    const load=async(text)=>{await page.getByLabel('Paste spreadsheet cells').fill(text);await page.getByRole('button',{name:'Load pasted rows',exact:true}).click()}
    await open()
    assert.equal(await page.getByLabel('Branch for this list').locator('option').filter({hasText:'Retired'}).count(),0)
    for(const method of ['api','sftp']){
      await page.getByRole('combobox',{name:/^Method/}).selectOption(method)
      await page.getByText('No connection is configured.',{exact:false}).waitFor()
      assert.equal(await page.getByLabel('CSV or TSV file').count(),0)
      assert.equal(calls.length,0)
    }
    await page.getByRole('combobox',{name:/^Method/}).selectOption('file')
    await load('external_id\tfirst_name')
    await page.getByRole('alert').filter({hasText:'at least one person'}).waitFor()
    await load('external_id\tfirst_name\n0001\tSam\n0002\t\n0001\tDuplicate\n0003\tJo')
    await page.getByLabel('Branch for this list').selectOption('north')
    await page.getByRole('button',{name:'Preview import',exact:true}).click()
    await page.getByText('2 ready; 2 invalid; 0 completed or skipped.',{exact:true}).waitFor()
    const importButton=page.getByRole('button',{name:'Import 2 students',exact:true})
    currentOrg='other'
    await importButton.click()
    await page.getByRole('alert').filter({hasText:'business context changed'}).waitFor()
    assert.equal(calls.length,0)
    currentOrg=org
    await importButton.click()
    await page.getByText('0 ready; 2 invalid; 2 completed or skipped.',{exact:true}).waitFor().catch(async error=>{console.log(await page.locator('main').innerText());console.log(JSON.stringify(calls));throw error})
    assert.equal(calls.length,1)
    assert.equal(calls[0].p_rows[0].external_id,'0001')
    await page.getByRole('button',{name:'Preview import',exact:true}).click()
    await page.getByText('0 ready; 2 invalid; 2 completed or skipped.',{exact:true}).waitFor()
    await page.getByLabel('People to import').selectOption('staff')
    await load('full_name\temail\trole\nAlex Example\talex@example.invalid\tteacher\nJo Example\tjo@example.invalid\tstaff\nElevated Example\tadmin@example.invalid\tadmin')
    await page.getByRole('button',{name:'Preview import',exact:true}).click()
    await page.getByText('2 ready; 1 invalid; 0 completed or skipped.',{exact:true}).waitFor()
    assert.equal(calls.length,1,'preview sends no invitations')
    await page.getByRole('button',{name:'Request 2 invitation(s)',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Invitations paused'}).waitFor()
    assert.equal(calls.length,2,'first failure pauses subsequent rows')
    await page.getByRole('button',{name:'Request 1 invitation(s)',exact:true}).click()
    await page.getByText('Invitation request accepted — delivery unverified',{exact:true}).waitFor()
    assert.equal(calls.length,3)
    assert.equal(calls[2].email,'jo@example.invalid','uncertain row is not automatically retried')
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width)
      evidence.push({width,overflow:false})
    }
    const dir=process.env.TEST_EVIDENCE_DIR||'work/people-import-evidence'
    fs.mkdirSync(dir,{recursive:true})
    await page.setViewportSize({width:390,height:844})
    await page.screenshot({path:path.join(dir,'staff-mobile.png'),fullPage:true})
    await page.getByLabel('People to import').selectOption('clients')
    await page.getByLabel('CSV or TSV file').setInputFiles({name:'synthetic.tsv',mimeType:'text/tab-separated-values',buffer:Buffer.from('external_id\tfirst_name\n0004\tTsv Example')})
    await page.getByText('synthetic.tsv: 1 rows loaded.',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Preview import',exact:true}).click()
    await page.getByText('1 ready; 0 invalid; 0 completed or skipped.',{exact:true}).waitFor()
    await page.getByLabel('CSV or TSV file').setInputFiles({name:'unsupported.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic')})
    await page.getByRole('alert').filter({hasText:'Export your workbook'}).waitFor()
    await load('external_id\tfirst_name\n0005\t')
    await page.getByRole('button',{name:'Preview import',exact:true}).click()
    await page.getByText('0 ready; 1 invalid; 0 completed or skipped.',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Import 0 students',exact:true}).isDisabled(),true)
    for(const restriction of ['permission','subscription']){
      denied=restriction==='permission';readonly=restriction==='subscription'
      await open()
      if(denied)assert.equal(await page.getByLabel('Paste spreadsheet cells').isDisabled(),true)
      else {
        await page.getByLabel('People to import').selectOption('staff')
        await load('full_name\temail\trole\nRead Only\tro@example.invalid\tstaff')
        await page.getByRole('button',{name:'Preview import',exact:true}).click()
        assert.equal(await page.getByRole('button',{name:'Request 1 invitation(s)',exact:true}).isDisabled(),true)
      }
      assert.equal(calls.length,3)
    }
    assert.deepEqual(errors,[])
    fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({passed:true,syntheticOnly:true,calls:calls.length,layouts:evidence,pageErrors:errors},null,2))
    console.log('Synthetic import browser checks passed: partial/repeated imports, tenant context, invitation pause/continue, restrictions, vocabulary, four viewport widths.')
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
