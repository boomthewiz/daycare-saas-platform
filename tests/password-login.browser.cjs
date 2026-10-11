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
    let sendFailure = true, saveFailure = true
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), name = url.pathname.split('/').pop()
      if (url.origin === base) {
        if (url.pathname === '/api/session-policy') return route.fulfill({ json: { enabled: false } })
        if (url.pathname === '/api/pin-status') return route.fulfill({ json: { hasPin: true, resetRequired: false } })
        if (url.pathname === '/api/email-login') {
          calls.push('email-request')
          return route.fulfill({ status: sendFailure ? 503 : 200, json: sendFailure ? { error: 'Synthetic email outage' } : { success: true } })
        }
        if (url.pathname === '/api/password-login') {
          calls.push('password-login')
          const body = request.postDataJSON()
          assert.equal(body.email, user.email)
          assert.equal(body.code, undefined)
          if (body.password === 'synthetic limited password') return route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { error: 'Too many sign-in attempts.' } })
          return route.fulfill({ status: body.password === 'synthetic correct password' ? 200 : 401, json: body.password === 'synthetic correct password' ? { state: 'unlocked', hasOrganization: true, session } : { error: 'Unable to sign in with that email and password.' } })
        }
        if (url.pathname === '/api/email-login/verify') {
          calls.push('email-verify')
          assert.equal(request.postDataJSON().password, undefined)
          return route.fulfill({ json: { state: 'unlocked', hasOrganization: true, session } })
        }
        if (url.pathname === '/api/account-password') {
          calls.push('password-save')
          assert.equal(request.headers().authorization, 'Bearer ' + token)
          return route.fulfill({ status: saveFailure ? 401 : 200, json: saveFailure ? { error: 'Sign in again within the last 10 minutes.' } : { success: true } })
        }
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
    await page.goto(base + '/login?next=/profile')
    await page.getByRole('button', { name: 'Send sign-in code', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0)
    await page.getByLabel('Email address', { exact: true }).fill(user.email)
    await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Synthetic email outage' }).waitFor()
    await page.getByRole('button', { name: 'Use password instead', exact: true }).click()
    assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), user.email)
    await page.getByLabel('Password', { exact: true }).fill('synthetic wrong password')
    await page.getByRole('button', { name: 'Sign in with password', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Unable to sign in' }).waitFor()
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '')
    await page.getByLabel('Password', { exact: true }).fill('synthetic correct password')
    const dir = process.env.TEST_EVIDENCE_DIR || path.join(__dirname, '../work/password-browser')
    fs.mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: path.join(dir, 'password-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Sign in with password', exact: true }).click()
    await page.waitForURL(base + '/profile')
    await page.getByRole('heading', { name: 'Set or change password', exact: true }).waitFor()
    await page.getByLabel('New password', { exact: true }).fill('synthetic new password')
    await page.getByLabel('Confirm password', { exact: true }).fill('synthetic mismatch')
    await page.getByRole('button', { name: 'Save password', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'do not match' }).waitFor()
    assert.equal(calls.filter(c => c === 'password-save').length, 0)
    await page.getByLabel('Confirm password', { exact: true }).fill('synthetic new password')
    await page.getByRole('button', { name: 'Save password', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '10 minutes' }).waitFor()
    assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), '')
    saveFailure = false
    await page.getByLabel('New password', { exact: true }).fill('synthetic new password')
    await page.getByLabel('Confirm password', { exact: true }).fill('synthetic new password')
    await page.getByRole('button', { name: 'Save password', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Password saved' }).waitFor()
    assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), '')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
    await page.screenshot({ path: path.join(dir, 'profile-mobile.png'), fullPage: true })
    await page.goto(base + '/login')
    await page.getByRole('button', { name: 'Use password instead', exact: true }).click()
    await page.getByRole('button', { name: 'Forgot password or haven’t set one up?', exact: true }).click()
    await page.getByText('Recovery requires email delivery.', { exact: false }).waitFor()
    sendFailure = false
    await page.getByLabel('Email address', { exact: true }).fill(user.email)
    await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
    await page.getByLabel('Email code', { exact: true }).fill('123456')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(base + '/profile')
    await page.goto(base + '/login')
    await page.getByRole('button', { name: 'Use password instead', exact: true }).click()
    await page.getByRole('button', { name: 'Use email code instead', exact: true }).click()
    assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0)
    // A customer can swap methods while an already requested code is pending.
    await page.getByLabel('Email address', { exact: true }).fill(user.email)
    await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
    await page.getByLabel('Email code', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Use password instead', exact: true }).click()
    assert.equal(await page.getByLabel('Email code', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Use email code instead', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: /^Try again in/ }).isDisabled(), true)
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      await page.getByRole('button', { name: 'Use password instead', exact: true }).click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
      await page.getByRole('button', { name: 'Use email code instead', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Use password instead', exact: true }).click()
    await page.getByLabel('Password', { exact: true }).fill('synthetic limited password')
    await page.getByRole('button', { name: 'Sign in with password', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Try password sign-in again in' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Sign in with password', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Use email code instead', exact: true }).click()
    await page.getByRole('button', { name: 'Use password instead', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Sign in with password', exact: true }).isDisabled(), true)
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ passed: true, syntheticOnly: true, externalRequests: 0, calls, viewports: [320, 390, 768, 1280], pageErrors: errors }, null, 2))
    console.log('PASS: email default, password fallback during SMTP outage, failed/successful sign-in, profile password setup, stale-session rejection, recovery and mobile layout.')
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
