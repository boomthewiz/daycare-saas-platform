const { test } = require('node:test')
const assert = require('node:assert/strict')
const { launchPlan, monthlyQuoteCents, trialEndForCreation, organizationAccess } = require('./helpers/load-ts.cjs')('lib/subscription-plan.ts')

test('organization minimum and provider quotes use integer cents', () => {
  assert.equal(monthlyQuoteCents(0), 7900)
  assert.equal(monthlyQuoteCents(1), 7900)
  assert.equal(monthlyQuoteCents(2), 10800)
  assert.equal(monthlyQuoteCents(5), 19500)
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => monthlyQuoteCents(count), RangeError)
  }
})

test('trial deadline is thirty elapsed days across daylight-saving changes', () => {
  assert.equal(trialEndForCreation('2026-10-15T12:00:00-05:00'), '2026-11-14T17:00:00.000Z')
  assert.equal(trialEndForCreation('2028-02-01T00:00:00Z'), '2028-03-02T00:00:00.000Z')
  assert.equal(launchPlan.cardRequiredForTrial, false)
  assert.throws(() => trialEndForCreation('invalid'), RangeError)
  assert.throws(() => trialEndForCreation('2026-09-24T00:00:00Z', 0), RangeError)
})

test('unpaid trial becomes read-only at its exact persisted expiration', () => {
  const entitlement = { trialEndsAt: '2026-10-24T12:00:00Z', paidThrough: null }
  assert.equal(organizationAccess(entitlement, '2026-10-24T11:59:59Z'), 'write')
  assert.equal(organizationAccess(entitlement, '2026-10-24T12:00:00Z'), 'read_only')
  assert.equal(organizationAccess(entitlement, '2026-10-25T12:00:00Z'), 'read_only')
})

test('paid period permits continued access without rewriting the trial', () => {
  const entitlement = { trialEndsAt: '2026-10-24T12:00:00Z', paidThrough: '2026-11-24T12:00:00Z' }
  assert.equal(organizationAccess(entitlement, '2026-11-01T12:00:00Z'), 'write')
  assert.equal(organizationAccess(entitlement, '2026-11-24T12:00:00Z'), 'read_only')
  assert.equal(entitlement.trialEndsAt, '2026-10-24T12:00:00Z')
})

test('missing entitlement grants only reads; malformed state never grants writes', () => {
  assert.equal(organizationAccess({ trialEndsAt: null, paidThrough: null }, '2026-09-24T00:00:00Z'), 'read_only')
  assert.equal(organizationAccess({ trialEndsAt: 'invalid', paidThrough: null }, '2026-09-24T00:00:00Z'), 'unavailable')
  assert.equal(organizationAccess({ trialEndsAt: null, paidThrough: null }, 'invalid'), 'unavailable')
})
