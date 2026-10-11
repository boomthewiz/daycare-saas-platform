/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic browser checks. */
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3047'
const source = process.env.TEST_SUPABASE_URL || 'https://workflow-test.supabase.co'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const org = '22222222-2222-4222-8222-222222222222'
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
const exp = Math.floor(Date.now() / 1000) + 36000
const token = Buffer.from('{"alg":"HS256"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp })).toString('base64url') + '.' + Buffer.from('synthetic-signature').toString('base64url')
const session = { access_token: token, refresh_token: 'synthetic', expires_at: exp, expires_in: 36000, token_type: 'bearer', user }
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const calls = [], errors = []
    let locked = false
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), name = url.pathname.split('/').pop()
      if (url.origin === base) {
        if (url.pathname === '/api/session-policy') return route.fulfill({ json: { enabled: true } })
        if (url.pathname === '/api/device-session') {
          const action = request.method() === 'GET' ? 'status' : request.postDataJSON().action
          calls.push(action)
          if (action === 'lock') locked = true
          if (action === 'unlock') locked = false
          const now = await page.evaluate(() => Date.now())
          return route.fulfill({ json: { state: locked ? 'locked' : 'unlocked', serverNow: new Date(now).toISOString(), unlockedUntil: new Date(now + 300000).toISOString(), fullAuthUntil: new Date(now + 86400000).toISOString(), pinRequiredBy: new Date(now + 86400000).toISOString() } })
        }
        if (url.pathname === '/api/pin-status') return route.fulfill({ json: { hasPin: true, resetRequired: false } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
        return route.continue()
      }
      if (url.origin !== new URL(source).origin) return route.abort()
      let data = []
      if (name === 'user') data = user
      if (name === 'token') data = session
      if (name === 'users') data = { ...user, full_name: 'Synthetic Owner', organization_id: org, role: 'owner', status: 'active' }
      if (name === 'current_organization_id') data = org
      if (name === 'subscription_access') data = { canWrite: false, canFinishSession: true, managed: true, serverNow: new Date().toISOString() }
      if (name.startsWith('can_')) data = true
      if (name === 'organization_terminology') data = {}
      return route.fulfill({ json: data })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', e => errors.push(e.message))
    await context.addInitScript(value => localStorage.setItem('sb-workflow-test-auth-token', JSON.stringify(value)), session)
    await page.goto(base + '/profile')
    await page.getByRole('heading', { name: 'Set or change password', exact: true }).waitFor()
    await new Promise(resolve => setTimeout(resolve, 200))
    await page.clock.install()
    const field = page.getByLabel('New password', { exact: true })
    await field.fill('synthetic unsaved password')
    for (let i = 0; i < 4; i++) {
      await page.clock.runFor(60000)
      await new Promise(resolve => setTimeout(resolve, 150))
      await field.press('End')
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    assert.ok(calls.filter(x => x === 'activity').length <= 4)
    assert.ok(calls.includes('activity'))
    await page.getByRole('button', { name: 'Lock', exact: true }).click()
    await page.getByLabel('Four-digit PIN').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
    await page.getByLabel('Four-digit PIN').fill('1234')
    await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    await field.waitFor()
    assert.equal(await field.inputValue(), 'synthetic unsaved password')
    await new Promise(resolve => setTimeout(resolve, 200))
    await page.clock.runFor(300000)
    await page.getByLabel('Four-digit PIN').waitFor()
    const dir = process.env.TEST_EVIDENCE_DIR || path.join(__dirname, '../work/heartbeat-browser')
    fs.mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: path.join(dir, 'pin-lock-mobile.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: true, calls }))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
