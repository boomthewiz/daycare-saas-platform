// Synthetic UI acceptance. All auth/database/billing responses are intercepted.
const { chromium } = require('playwright'), assert = require('node:assert/strict')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3020'
const id = '22222222-2222-4222-8222-222222222222', org = '33333333-3333-4333-8333-333333333333'
const user = { id, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', app_metadata: {}, user_metadata: {} }
const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 36000 })).toString('base64url') + '.synthetic'
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  let mode = 'trial', actions = [], errors = []
  try {
    await context.addInitScript(({ token, user }) => localStorage.setItem('sb-workflow-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', expires_at: Math.floor(Date.now() / 1000) + 36000, expires_in: 36000, token_type: 'bearer', user })), { token, user })
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), p = url.pathname
      if (url.origin === new URL(base).origin) {
        if (p === '/api/session-policy') return route.fulfill({ json: { enabled: false } })
        if (p === '/api/pin-status') return route.fulfill({ json: { hasPin: true, resetRequired: false } })
        if (p === '/api/billing') {
          if (route.request().method() === 'POST') {
            const action = route.request().postDataJSON().action; actions.push(action)
            if (action === 'cancel') mode = 'canceled'
            return route.fulfill({ json: { success: true } })
          }
          if (mode === 'denied') return route.fulfill({ status: 403, json: { error: 'Only the organization owner can manage billing.' } })
          return route.fulfill({ json: { managed: mode !== 'legacy', enabled: mode !== 'disabled', status: mode === 'trial' ? 'not_subscribed' : 'active', providers: 5, monthlyAmount: 19500,
            trialEndsAt: new Date(Date.now() + 86400000).toISOString(), paidThrough: mode === 'paid' ? new Date(Date.now() + 30 * 86400000).toISOString() : null,
            subscribed: ['paid', 'canceled'].includes(mode), cancelAt: mode === 'canceled' ? new Date(Date.now() + 86400000).toISOString() : null } })
        }
        if (p === '/api/create-subscription') { actions.push('checkout'); return route.fulfill({ status: 503, json: { error: 'Synthetic checkout failure. Please retry.' } }) }
        return route.continue()
      }
      if (url.origin !== 'https://workflow-test.supabase.co') return route.abort()
      let data = []
      if (p === '/auth/v1/user') data = user
      else if (p.endsWith('/rpc/current_organization_id')) data = org
      else if (p.endsWith('/rpc/subscription_access')) data = { managed: false, canWrite: true, canFinishSession: true, serverNow: new Date().toISOString() }
      else if (p.includes('/rpc/can_') || p.includes('/rpc/is_')) data = true
      else if (p.endsWith('/users')) data = { ...user, full_name: 'Synthetic Owner', organization_id: org, role: 'owner', status: 'active' }
      else if (p.endsWith('/user_permissions')) data = { can_manage_billing: true }
      else if (p.endsWith('/organization_terminology')) data = null
      await route.fulfill({ json: data })
    })
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20000)
    await page.goto(base + '/billing')
    await page.getByText('$195.00 USD/month', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Subscribe', exact: true }).click()
    await page.getByText('Synthetic checkout failure. Please retry.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Subscribe', exact: true }).isEnabled(), true)
    mode = 'paid'; await page.reload()
    await page.getByRole('button', { name: 'Cancel subscription', exact: true }).click()
    assert.equal(actions.includes('cancel'), false)
    await page.getByRole('button', { name: 'Keep subscription', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel subscription', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
    await page.getByText(/Cancellation scheduled for/).waitFor()
    assert.equal(actions.filter(a => a === 'cancel').length, 1)
    for (const next of ['legacy', 'disabled', 'denied']) {
      mode = next; await page.reload()
      await page.getByText(next === 'legacy' ? /existing access has not changed/ : next === 'disabled' ? /checkout is temporarily unavailable/ : /Only the organization owner/).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Subscribe', exact: true }).count(), 0)
    }
    mode = 'trial'; await page.setViewportSize({ width: 390, height: 844 }); await page.reload()
    await page.getByText('$195.00 USD/month', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(errors, [])
    console.log('Billing browser acceptance passed: quote, failure recovery, cancellation confirmation, legacy/disabled/denied and mobile.')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
