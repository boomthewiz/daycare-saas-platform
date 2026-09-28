const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const Stripe = require('stripe')
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file)
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths
  mod.require = name => name in mocks ? mocks[name] : name.startsWith('@/') ? load(name.slice(2) + '.ts', mocks) : require(name)
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename)
  return mod.exports
}
const policy = load('lib/billing-policy.ts')
test('actual Stripe test invoice maps to its settled service period', () => {
  const paid = require('./fixtures/stripe-paid-invoice.json')
  assert.equal(policy.paidDeadline(paid, 'sub_1UKWLNCxlg8hHxkPbcNhrCjx', 'cus_VLCk41WHIeorxP', 'price_1UKWHLCxlg8hHxkP27zSb6kF'),
    new Date(1793162324 * 1000).toISOString())
})
const future = Math.floor(Date.now() / 1000) + 30 * 86400
const invoice = (end = future) => ({ id: 'in_paid', livemode: false, status: 'paid', amount_remaining: 0, currency: 'usd', customer: 'cus_own',
  parent: { subscription_details: { subscription: 'sub_own' } }, billing_reason: 'subscription_cycle',
  lines: { has_more: false, data: [{ quantity: 1, amount: 7900, pricing: { price_details: { price: 'base' } },
    parent: { type: 'subscription_item_details', subscription_item_details: { subscription: 'sub_own', proration: false } }, period: { end } }] } })
function subscription(seats = 1, status = 'active') {
  return { id: 'sub_own', customer: 'cus_own', livemode: false, status, schedule: null, cancel_at: null, pending_update: null,
    items: { data: [{ id: 'si_base', price: { id: 'base', currency: 'usd' }, quantity: 1, current_period_end: future },
      ...(seats > 1 ? [{ id: 'si_extra', price: { id: 'extra', currency: 'usd' }, quantity: seats - 1, current_period_end: future }] : []) ] } }
}
function harness(options = {}) {
  const state = { managed: true, organization_id: 'org_own', customer_id: 'cus_own', subscription_id: null, checkout_id: null,
    lease: 'lease', trial_ends_at: new Date(Date.now() + 10 * 86400000).toISOString(), paid_through: null,
    provider_count: 5, seats: 1, desired_revision: 4, synced_revision: -1, operation: null, ...options.state }
  const calls = [], saved = [], checkoutSessions = {}
  let sub = options.sub || null
  const stripe = {
    customers: { create: async (args, opts) => { calls.push(['customer', args, opts]); return { id: 'cus_own' } } },
    subscriptions: {
      list: async () => ({ data: sub ? [structuredClone(sub)] : [], has_more: false }),
      retrieve: async () => structuredClone(sub),
      create: async (args, opts) => { calls.push(['subscribe', args, opts]); sub = subscription(5, 'trialing'); return sub },
      update: async (id, args, opts) => {
        calls.push(['update', id, args, opts])
        if (args.cancel_at_period_end) sub.cancel_at = future
        if (args.items) sub = subscription(args.items[0]?.deleted ? 1 : 1 + args.items[0].quantity, sub.status)
        return sub
      },
    },
    invoices: { list: async () => ({ data: options.invoices || [] }) },
    checkout: { sessions: {
      create: async (args, opts) => { calls.push(['checkout', args, opts]); const value = { id: 'cs_own', status: 'open', customer: 'cus_own', url: 'https://checkout.stripe.com/test', ...args }; checkoutSessions[value.id] = value; return value },
      retrieve: async id => options.checkout || checkoutSessions[id],
      expire: async id => { calls.push(['expire', id]); checkoutSessions[id].status = 'expired' },
    } },
    setupIntents: { retrieve: async () => ({ status: 'succeeded', customer: 'cus_own', payment_method: 'pm_test', livemode: false }) },
    subscriptionSchedules: {
      create: async args => { calls.push(['schedule', args]); sub.schedule = 'sched_own'; return { id: 'sched_own' } },
      retrieve: async () => ({ id: 'sched_own', metadata: { rejoyce: 'org_own' }, phases: [{}], current_phase: { start_date: future - 30 * 86400 } }),
      update: async (id, args) => { calls.push(['schedule-update', id, args]); return {} },
      release: async id => { calls.push(['release', id]); sub.schedule = null },
    },
  }
  const mocks = {
    '@/lib/device-session-server': { requireUnlocked: async () => options.locked ? null : { user: { id: 'verified_owner' }, sessionId: 'verified_session' } },
    '@/lib/stripe-config': { billingStripe: async () => ({ stripe, config: { base: 'base', provider: 'extra', origin: 'https://test.invalid' } }) },
    '@/lib/supabase-admin': { supabaseAdmin: { rpc: async (name, args) => {
      saved.push([name, structuredClone(args)])
      if (name === 'billing_owner_context') return options.denied ? { error: { code: '42501' } } : { data: structuredClone(state) }
      if (name === 'billing_lock') return { data: options.busy ? null : structuredClone(state) }
      if (name === 'billing_save') {
        if (options.failSave && args.p_patch.checkout_id) { options.failSave = false; return { error: { code: 'offline' } } }
        Object.assign(state, args.p_patch); return { data: null }
      }
    } } },
  }
  const server = load('lib/billing-server.ts', mocks)
  return { state, calls, saved, server, run: fn => server.withBilling('org_own', null, fn), mocks }
}
test('paid access requires a settled base invoice for the linked customer and subscription', () => {
  assert.equal(policy.paidDeadline(invoice(), 'sub_own', 'cus_own', 'base'), new Date(future * 1000).toISOString())
  for (const patch of [{ livemode: true }, { status: 'open' }, { amount_remaining: 7900 }, { customer: 'cus_foreign' },
    { currency: 'eur' }, { billing_reason: 'subscription_update' }, { parent: { subscription_details: { subscription: 'sub_foreign' } } }]) {
    assert.equal(policy.paidDeadline({ ...invoice(), ...patch }, 'sub_own', 'cus_own', 'base'), null)
  }
  for (const modify of [line => { line.amount = 0 }, line => { line.parent.subscription_item_details.proration = true },
    line => { line.pricing.price_details.price = 'extra' }]) {
    const input = invoice(); modify(input.lines.data[0]); assert.equal(policy.paidDeadline(input, 'sub_own', 'cus_own', 'base'), null)
  }
})
test('Checkout uses trusted seats and deadline and reuses an open session on repeated requests', async () => {
  const h = harness()
  await h.run(w => w.checkout()); await h.run(w => w.checkout())
  const calls = h.calls.filter(c => c[0] === 'checkout'); assert.equal(calls.length, 1)
  const args = calls[0][1]
  assert.deepEqual(args.line_items, [{ price: 'base', quantity: 1 }, { price: 'extra', quantity: 4 }])
  assert.equal(args.subscription_data.trial_end, Math.floor(Date.parse(h.state.trial_ends_at) / 1000))
  assert.equal(args.payment_method_types, undefined)
  assert.equal(h.state.paid_through, null)
})
test('short remaining trial uses setup checkout and preserves its exact deadline on server subscription', async () => {
  const deadline = new Date(Date.now() + 3600000).toISOString()
  const h = harness({ state: { trial_ends_at: deadline } }); await h.run(w => w.checkout())
  assert.equal(h.calls[0][1].mode, 'setup')
  const ready = harness({ state: { checkout_id: 'cs_ready', trial_ends_at: deadline }, checkout: {
    mode: 'setup', status: 'complete', customer: 'cus_own', setup_intent: 'seti_own', livemode: false,
  } })
  await ready.run(w => w.refresh())
  assert.equal(ready.calls[0][1].trial_end, Math.floor(Date.parse(deadline) / 1000))
  assert.equal(ready.state.checkout_id, null); assert.equal(ready.state.paid_through, null)
})
test('existing subscription prevents duplicate checkout including incomplete and past due', async () => {
  for (const status of ['active', 'trialing', 'incomplete', 'past_due', 'unpaid']) {
    const h = harness({ sub: subscription(1, status) })
    await assert.rejects(h.run(w => w.checkout()), /already has a subscription/)
    assert.equal(h.calls.length, 0)
  }
})
test('recovered setup completion cannot recreate a subsequently canceled subscription', async () => {
  const h = harness({ sub: subscription(5), state: { checkout_id: 'cs_ready' }, checkout: {
    mode: 'setup', status: 'complete', customer: 'cus_own', setup_intent: 'seti_own', livemode: false,
  } })
  await h.run(w => w.refresh())
  assert.equal(h.state.checkout_id, null)
  await h.run(w => w.cancel())
  assert.equal(h.calls.filter(c => c[0] === 'subscribe').length, 0)
})
test('Stripe success followed by database failure replays identical durable request and key', async () => {
  const h = harness({ failSave: true })
  await assert.rejects(h.run(w => w.checkout()), /storage unavailable/)
  const pending = structuredClone(h.state.operation)
  assert.ok(pending.key)
  await h.run(w => w.checkout())
  const calls = h.calls.filter(c => c[0] === 'checkout')
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(h.state.operation, null)
  const before = h.saved.findIndex(c => c[1].p_patch?.operation?.key === pending.key)
  assert.ok(before >= 0)
})
test('ambiguous operation past idempotency retention fails closed', async () => {
  const h = harness({ state: { operation: { kind: 'customer', created: Date.now() - 24 * 3600000, key: 'old', args: {} } } })
  await assert.rejects(h.run(w => w.checkout()), /manual reconciliation/); assert.equal(h.calls.length, 0)
})
test('failed renewal and delayed older invoices never extend or regress paid access', async () => {
  const deadline = new Date(future * 1000).toISOString()
  const h = harness({ sub: subscription(5, 'past_due'), state: { paid_through: deadline }, invoices: [invoice(future - 86400)] })
  await h.run(w => w.refresh()); await h.run(w => w.refresh())
  assert.equal(h.state.status, 'past_due'); assert.equal(h.state.paid_through, deadline)
  const renewed = harness({ sub: subscription(5), state: { paid_through: deadline }, invoices: [invoice(future + 30 * 86400)] })
  await renewed.run(w => w.refresh())
  assert.equal(renewed.state.paid_through, new Date((future + 30 * 86400) * 1000).toISOString())
})
test('seat additions invoice prorations immediately and gate Stripe update on payment', async () => {
  const h = harness({ sub: subscription(1) }); await h.run(w => w.synchronizeSeats())
  const update = h.calls.find(c => c[0] === 'update')[2]
  assert.equal(update.proration_behavior, 'always_invoice'); assert.equal(update.payment_behavior, 'pending_if_incomplete')
  assert.equal(update.items[0].quantity, 4)
})
test('seat reductions schedule next renewal and duplicate webhook does not rebuild schedule', async () => {
  const h = harness({ sub: subscription(5), state: { provider_count: 2 } })
  await h.run(w => w.synchronizeSeats()); await h.run(w => w.synchronizeSeats())
  const calls = h.calls.filter(c => c[0] === 'schedule-update'); assert.equal(calls.length, 1)
  assert.equal(calls[0][2].phases[0].end_date, future)
  assert.deepEqual(calls[0][2].phases[1].items, [{ price: 'base', quantity: 1 }, { price: 'extra', quantity: 1 }])
})
test('cancellation releases reduction schedule then cancels at period end without removing paid access', async () => {
  const sub = subscription(5); sub.schedule = 'sched_own'
  const deadline = new Date(future * 1000).toISOString()
  const h = harness({ sub, state: { paid_through: deadline } })
  await h.run(w => w.cancel())
  assert.equal(h.calls[0][0], 'release'); assert.deepEqual(h.calls[1][2], { cancel_at_period_end: true })
  assert.equal(h.state.paid_through, deadline); assert.equal(h.state.cancel_at, deadline)
})
test('owner identity is verified and forwarded to SQL independently of browser claims', async () => {
  const h = harness()
  await h.server.ownerContext(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ userId: 'attacker', organizationId: 'foreign' }) }))
  assert.deepEqual(h.saved[0][1], { p_user: 'verified_owner', p_session: 'verified_session' })
  await assert.rejects(harness({ locked: true }).server.ownerContext(new Request('https://test.invalid')), /unlock/)
  await assert.rejects(harness({ denied: true }).server.ownerContext(new Request('https://test.invalid')), /owner/)
})
test('webhook verifies raw signature and mode before invoking tenant reconciliation', async () => {
  const secret = 'synthetic_webhook_secret'
  const calls = []
  const route = load('app/api/webhook/route.ts', {
    '@/lib/stripe-config': { billingConfig: () => ({ key: 'synthetic', webhook: secret }) },
    '@/lib/billing-server': { withBilling: async (...args) => { calls.push(args.slice(0, 2)) } },
  })
  const payload = JSON.stringify({ id: 'evt_test', type: 'invoice.paid', livemode: false, data: { object: { customer: 'cus_own', metadata: { organization_id: 'foreign' } } } })
  async function post(body, signature) { return route.POST(new Request('https://test.invalid/api/webhook', { method: 'POST', body, headers: { 'stripe-signature': signature } })) }
  assert.equal((await post(payload, 'invalid')).status, 400)
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret })
  assert.equal((await post(payload + ' ', signature)).status, 400)
  assert.equal((await post(payload, signature)).status, 200)
  assert.equal((await post(payload, signature)).status, 200)
  assert.deepEqual(calls, [[null, 'cus_own'], [null, 'cus_own']])
  const live = payload.replace('"livemode":false', '"livemode":true')
  assert.equal((await post(live, Stripe.webhooks.generateTestHeaderString({ payload: live, secret }))).status, 400)
})

test('billing configuration fails closed for live keys, production deployments and the production database', () => {
  const names = ['STRIPE_BILLING_ENABLED','STRIPE_SECRET_KEY','STRIPE_ACCOUNT_ID','STRIPE_BASE_PRICE_ID','STRIPE_PROVIDER_PRICE_ID',
    'STRIPE_WEBHOOK_SECRET','STRIPE_PORTAL_CONFIGURATION_ID','BILLING_APP_ORIGIN','NEXT_PUBLIC_SUPABASE_URL','VERCEL_ENV']
  const previous = Object.fromEntries(names.map(n => [n, process.env[n]]))
  try {
    Object.assign(process.env, { STRIPE_BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: ['rk','test','synthetic'].join('_'),
      STRIPE_ACCOUNT_ID: 'acct_test', STRIPE_BASE_PRICE_ID: 'base', STRIPE_PROVIDER_PRICE_ID: 'extra', STRIPE_WEBHOOK_SECRET: 'synthetic',
      STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test', BILLING_APP_ORIGIN: 'https://test.invalid', NEXT_PUBLIC_SUPABASE_URL: 'https://workflow-test.supabase.co', VERCEL_ENV: 'preview' })
    const { billingConfig } = load('lib/stripe-config.ts')
    assert.equal(billingConfig().account, 'acct_test')
    for (const [name, value] of [['STRIPE_SECRET_KEY',['rk','live','synthetic'].join('_')], ['VERCEL_ENV','production'],
      ['NEXT_PUBLIC_SUPABASE_URL','https://lvtabzfkajgicjfexvxx.supabase.co'], ['STRIPE_BILLING_ENABLED','false'],
      ['BILLING_APP_ORIGIN','https://test.invalid/redirect'], ['STRIPE_WEBHOOK_SECRET','']]) {
      const old = process.env[name]; process.env[name] = value
      assert.throws(billingConfig); process.env[name] = old
    }
  } finally { for (const [name,value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } }
})
