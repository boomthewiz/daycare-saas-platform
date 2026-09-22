const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizePermissions, emptyPermissions, canEditPermission } = require('./helpers/load-ts.cjs')('lib/permissions.ts')

test('permission normalization accepts only explicit true and drops unknown and identity fields', () => {
  const grants = normalizePermissions({
    can_manage_users: true, can_manage_clients: 'true', can_manage_sessions: 1,
    can_review_sessions: null, can_view_reports: false,
    can_manage_billing: {}, can_delegate_permissions: undefined,
    user_id: 'victim', organization_id: 'foreign', can_do_anything: true,
  })
  assert.deepEqual(grants, {
    can_delegate_permissions: false, can_manage_users: true, can_manage_clients: false,
    can_manage_sessions: false, can_review_sessions: false, can_view_reports: false,
    can_manage_billing: false,
  })
  assert.equal(normalizePermissions(Object.create({ can_manage_billing: true })).can_manage_billing, false)
})

test('missing permission records deny all grants and defaults do not share mutable state', () => {
  for (const missing of [null, undefined, '', true, []]) {
    assert.ok(Object.values(normalizePermissions(missing)).every(value => value === false))
  }
  const first = emptyPermissions()
  first.can_manage_billing = true
  assert.equal(emptyPermissions().can_manage_billing, false)
})

test('editor checks preserve explicit delegation and sensitive grant restrictions', () => {
  const editor = { role: 'manager', canManageUsers: true, canDelegatePermissions: false, isSelf: false, targetIsOwner: false }
  assert.equal(canEditPermission(editor, 'can_view_reports'), false)
  assert.equal(canEditPermission({ ...editor, canDelegatePermissions: true }, 'can_view_reports'), true)
  for (const key of ['can_manage_billing', 'can_delegate_permissions']) {
    assert.equal(canEditPermission({ ...editor, canDelegatePermissions: true }, key), false)
    for (const role of ['owner', 'admin']) assert.equal(canEditPermission({ ...editor, role }, key), true)
  }
  for (const change of [{ isSelf: true }, { targetIsOwner: true }, { canManageUsers: false }]) {
    assert.equal(canEditPermission({ ...editor, role: 'admin', ...change }, 'can_manage_users'), false)
  }
  assert.equal(canEditPermission({ ...editor, role: 'owner' }, 'unknown_permission'), false)
})
