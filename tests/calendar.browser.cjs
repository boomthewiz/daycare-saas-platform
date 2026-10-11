/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic browser checks. */
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.TEST_BASE_URL || 'http://localhost:3047'
const source = process.env.TEST_SUPABASE_URL || 'https://workflow-test.supabase.co'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const org = '22222222-2222-4222-8222-222222222222'
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
const exp = Math.floor(Date.now()/1000) + 360000
const token = Buffer.from('{"alg":"HS256"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp })).toString('base64url') + '.' + Buffer.from('synthetic-signature').toString('base64url')
const session = { access_token: token, refresh_token: 'synthetic', expires_at: exp, expires_in: 360000, token_type: 'bearer', user }
const provider = { id: '33333333-3333-4333-8333-333333333333', full_name: 'Demo Educator', email: 'educator@example.invalid', role: 'teacher', status: 'active' }
const client = { id: '44444444-4444-4444-8444-444444444444', first_name: 'Demo Child', preferred_name: 'Demo Child', status: 'active', assigned_provider_id: provider.id, client_locations: [{location_id:'north'}] }
const output = process.env.CALENDAR_SCREENSHOTS || path.join(__dirname, '../work/calendar-screenshots')
fs.mkdirSync(output, { recursive: true })
const makeEvent = (id, start, end, branch = 'north', status = 'scheduled') => ({ id, client_id: client.id, provider_id: provider.id, status, session_type: 'care', scheduled_start: start, scheduled_end: end, location: 'Room 1', clients: { first_name: 'Demo Child', preferred_name: id === 'overlap' ? 'Demo Child B' : 'Demo Child' }, provider, session_targets: [], attendance_status: 'unknown', created_at: start, branch })
const events = [
  makeEvent('morning','2026-10-12T09:00:00-05:00','2026-10-12T10:00:00-05:00'),
  makeEvent('overlap','2026-10-12T09:30:00-05:00','2026-10-12T11:00:00-05:00','south'),
  makeEvent('overnight','2026-10-11T23:30:00-05:00','2026-10-12T00:30:00-05:00'),
  makeEvent('next-day','2026-10-13T10:00:00-05:00','2026-10-13T11:00:00-05:00'),
  ...Array.from({length:15}, (_,i) => makeEvent('later-'+i, `2026-10-12T${String(12+Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}:00-05:00`, `2026-10-12T${String(12+Math.floor(i/2)).padStart(2,'0')}:${i%2?'50':'20'}:00-05:00`, 'north', i===0?'completed':'scheduled')),
]

;(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true })
  try {
    for (const scenario of ['scheduler','staff','readonly','delegated']) {
      const canSchedule = scenario !== 'staff', canWrite = scenario !== 'readonly'
      const context = await browser.newContext({ viewport:{width:1440,height:1000}, timezoneId:'America/Chicago' })
      const errors = [], requests = [], saves = []
      let failCalendar = false
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), name = url.pathname.split('/').pop()
        if (url.origin === base) {
          if (url.pathname === '/api/session-policy') return route.fulfill({json:{enabled:false}})
          if (url.pathname === '/api/pin-status') return route.fulfill({json:{hasPin:true,resetRequired:false}})
          if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}})
          return route.continue()
        }
        if (url.origin !== new URL(source).origin) return route.abort()
        let data = []
        if (name === 'user') data = user
        if (name === 'token') data = session
        if (name === 'users') data = url.searchParams.has('id') ? {...user, full_name:'Demo Administrator', organization_id:org, role:scenario==='scheduler'?'owner':'teacher',status:'active'} : [provider]
        if (name === 'user_permissions') data = {can_manage_sessions:canSchedule,can_manage_clients:canSchedule}
        if (name === 'current_organization_id') data = org
        if (name === 'subscription_access') data = {canWrite,canFinishSession:true,managed:scenario==='readonly',serverNow:new Date().toISOString()}
        if (name.startsWith('can_')) data = canSchedule
        if (name === 'organization_locations') data = [{id:'north',name:'North branch',active:true},{id:'south',name:'South branch',active:true}]
        if (name === 'organization_terminology') data = {}
        if (name === 'clients') data = [client]
        if (name === 'session_types') data = [{id:'type-a',organization_id:org,name:'Learning & care',code:'care',active:true,default_duration_minutes:60}]
        if (name === 'session_people_readiness') data = {missing_clients:false,missing_staff:false}
        if (name === 'create_prepared_session') {
          const body = request.postDataJSON(); saves.push(body)
          data = {session_id:'saved-session', client_id:client.id, provider_id:provider.id, scheduled_start:body.requested_scheduled_start, scheduled_end:body.requested_scheduled_end,status:'scheduled',targets_added:0}
        }
        if (name === 'sessions') {
          requests.push(url)
          if (failCalendar && url.searchParams.has('or')) return route.fulfill({status:503,json:{message:'Synthetic calendar interruption'}})
          const selectedBranch = url.searchParams.get('clients.client_locations.location_id')?.replace(/^eq\./,'')
          const end = url.searchParams.get('scheduled_start')?.replace(/^lt\./,'')
          const start = url.searchParams.get('or')?.match(/scheduled_end\.gt\.([^,]+)/)?.[1]
          data = events.filter(event => (!selectedBranch || selectedBranch === event.branch) && (!end || new Date(event.scheduled_start) < new Date(end)) && (!start || new Date(event.scheduled_end) > new Date(start)))
          if (scenario === 'staff') data = data.filter(event=>event.id==='morning') // Synthetic RLS response.
          const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 500)
          data = data.slice(offset,offset+limit)
        }
        return route.fulfill({json:data})
      })
      await context.addInitScript(value=>localStorage.setItem('sb-workflow-test-auth-token',JSON.stringify(value)),session)
      await context.addInitScript(() => {
        const RealDate = Date
        window.Date = class extends RealDate {
          constructor(...args) { if (args.length) super(...args); else super('2026-10-12T14:00:00Z') }
          static now() { return new RealDate('2026-10-12T14:00:00Z').getTime() }
        }
      })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      page.on('pageerror',error=>errors.push(error.message))
      await page.goto(base+'/dashboard')
      await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor()
      await page.getByRole('link',{name:/Demo Child,.*scheduled/}).first().waitFor()
      assert.equal(await page.locator('#calendar-view').inputValue(),'auto')
      assert.equal(await page.locator('main').getByText('Read-only access:',{exact:false}).count(),0)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1440)
      if (scenario === 'scheduler') {
        await page.getByRole('button',{name:'Create Session',exact:true}).waitFor()
        const totals = page.getByRole('region',{name:"Today's session totals"})
        await totals.getByText('17',{exact:true}).waitFor()
        assert.equal(await totals.getByText('1',{exact:true}).count(),1)
        await page.screenshot({path:path.join(output,'calendar-desktop.png')})
        await page.getByRole('button',{name:'Collapse sidebar'}).click()
        await page.waitForTimeout(350)
        assert.equal(await page.locator('#desktop-navigation aside').evaluate(el=>el.offsetWidth),80)
        await page.getByRole('button',{name:'Expand sidebar'}).click()
        await page.waitForTimeout(350)
        await page.getByRole('combobox',{name:'Client branch'}).selectOption('south')
        await totals.getByText('1',{exact:true}).first().waitFor()
        await page.getByRole('link',{name:/Demo Child B/}).waitFor()
        assert.equal(await page.getByRole('link',{name:/Demo Child,/}).count(),0)
        assert.ok(requests.some(url=>url.searchParams.get('clients.client_locations.location_id')==='eq.south'))
        await page.getByRole('combobox',{name:'Client branch'}).selectOption('')
        await totals.getByText('17',{exact:true}).waitFor()
        await page.getByRole('combobox',{name:'Calendar view'}).selectOption('range')
        await page.getByLabel('Range start').fill('2026-10-01')
        await page.getByLabel('Range end').fill('2026-10-31')
        await page.getByRole('heading',{name:'Monday, Oct 12'}).waitFor()
        await page.getByLabel('Range end').fill('2026-11-15')
        await page.getByRole('alert').getByText(/1–31 days/).waitFor()
        await page.getByRole('combobox',{name:'Calendar view'}).selectOption('auto')
        await page.getByLabel('Go to date').fill('2026-10-12')
        await page.getByRole('button',{name:'Next date range'}).click()
        await page.getByText('No sessions in this date range.',{exact:false}).waitFor()
        await page.getByRole('button',{name:'Previous date range'}).click()
        await page.getByRole('link',{name:/Demo Child,.*scheduled/}).first().waitFor()
        failCalendar = true
        await page.getByRole('button',{name:'Refresh calendar'}).click()
        await page.getByRole('alert').getByText('Synthetic calendar interruption').waitFor()
        failCalendar = false
        await page.getByRole('button',{name:'Try again',exact:true}).first().click()
        await page.getByRole('link',{name:/Demo Child,.*scheduled/}).first().waitFor()
        const slot = page.getByRole('button',{name:'Create Session Monday, Oct 12 10:00 AM',exact:true})
        await slot.focus()
        await slot.press('ArrowRight')
        assert.equal(await page.locator(':focus').getAttribute('data-day'),'2')
        await page.locator(':focus').press('ArrowLeft')
        await page.locator(':focus').press('ArrowDown')
        assert.match(await page.locator(':focus').getAttribute('aria-label'),/Monday, Oct 12 10:30 AM/)
        await page.locator(':focus').press('Enter')
        try { await page.locator('#create-session input[type="datetime-local"]').first().waitFor() }
        catch (error) { console.log('navigation',page.url(), await page.locator('body').innerText(),errors); throw error }
        assert.equal(await page.locator('#create-session input[type="datetime-local"]').first().inputValue(),'2026-10-12T10:30')
        await page.waitForFunction(()=>document.querySelectorAll('#create-session input[type="datetime-local"]')[1]?.value==='2026-10-12T11:30')
        await page.locator('#create-session select').nth(0).selectOption(client.id)
        await page.locator('#create-session select').nth(1).selectOption(provider.id)
        await page.locator('#create-session').getByRole('button',{name:'Create Session',exact:true}).click()
        try { await page.getByRole('heading',{name:'Session created successfully'}).waitFor() }
        catch (error) { console.log('saves', saves, 'page', await page.locator('main').innerText()); throw error }
        assert.equal(saves.length,1)
        assert.equal(saves[0].requested_scheduled_start,'2026-10-12T15:30:00.000Z')
        assert.equal(saves[0].requested_scheduled_end,'2026-10-12T16:30:00.000Z')
        await page.goto(base+'/dashboard')
        await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor()
        await page.setViewportSize({width:390,height:844})
        await page.getByRole('link',{name:/Demo Child,.*scheduled/}).first().waitFor()
        assert.equal(await page.getByLabel('Calendar time grid').locator('div.grid > div.sticky').count(),2)
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390)
        assert.ok(await page.getByRole('button',{name:'Create Session Monday, Oct 12 10:00 AM',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44))
        await page.screenshot({path:path.join(output,'calendar-mobile.png')})
        const menu = page.getByRole('button',{name:'Open navigation menu'})
        await menu.click()
        const dialog = page.getByRole('dialog',{name:'Navigation menu'})
        assert.equal(await dialog.evaluate(el=>Math.round(el.getBoundingClientRect().width)),390)
        assert.equal(await dialog.evaluate(el=>Math.round(el.getBoundingClientRect().height)),844)
        await page.screenshot({path:path.join(output,'mobile-menu.png')})
        await page.keyboard.press('Shift+Tab')
        assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(100)
        assert.ok(await menu.evaluate(el=>el===document.activeElement))
        await menu.click()
        await dialog.getByRole('link',{name:'Tasks',exact:true}).click()
        await page.waitForURL('**/tasks')
        assert.equal(await page.locator('dialog[open]').count(),0)
        await page.goto(base+'/team-management')
        await page.getByRole('button',{name:/^Clients.*1 total.*1 active/}).waitFor()
        await page.getByRole('button',{name:/^Team Members.*1 total.*1 active/}).waitFor()
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390)
      } else if (scenario === 'staff' || scenario === 'readonly') {
        assert.equal(await page.getByRole('button',{name:'Create Session',exact:true}).count(),0)
        assert.ok(await page.getByRole('button',{name:/Create Session Monday/}).first().isDisabled())
        await page.getByText('Access info',{exact:true}).click()
        await page.getByText(/primary administrator to review your access/).waitFor()
        if (scenario === 'readonly') await page.getByText(/current subscription/).waitFor()
        else assert.equal(await page.getByText(/current subscription/).count(),0)
      } else {
        assert.ok(await page.getByRole('button',{name:'Create Session',exact:true}).isEnabled())
      }
      assert.deepEqual(errors,[],scenario)
      await context.close()
      console.log(scenario+': calendar, access and navigation checks passed')
    }
  } finally { await browser.close() }
})().catch(error=>{console.error(error);process.exitCode=1})
