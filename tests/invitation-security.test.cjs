const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const permissions = require('./helpers/load-ts.cjs')('lib/permissions.ts')

const caller = { id: 'caller', organization_id: 'org', role: 'owner', status: 'active' }
const target = { id: 'target', organization_id: 'org', role: 'staff', status: 'active', email: 'staff@example.com', full_name: 'Staff' }
const body = { fullName: 'Staff', email: target.email, role: 'staff', organizationId: 'org', resend: true }

function load(options = {}) {
  const calls = []
  const record = (name, value) => calls.push([name, value])
  const admin = {
    auth: {
      getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: caller.id } }, error: null }),
      admin: {
        getUserById: async id => { record('getUserById', id); return { data: { user: options.authTarget === undefined ? { email: target.email } : options.authTarget }, error: null } },
        generateLink: async args => { record('generateLink', args); return { data: {}, error: null } },
        listUsers: async args => { record('listUsers', args); return { data: { users: options.fullDirectory ? Array(1000).fill({ email: 'other@example.com' }) : [] }, error: null } },
        inviteUserByEmail: async email => { record('invite', email); return { data: { user: { id: 'new-user' } }, error: null } },
      },
    },
    from: table => {
      record('from', table)
      const q = {}
      for (const method of ['select', 'eq', 'ilike', 'upsert', 'update']) {
        q[method] = (...args) => { record(method, args); return q }
      }
      q.single = async () => ({ data: { ...caller, ...options.caller }, error: null })
      q.limit = async () => ({ data: options.targets === undefined ? [target] : options.targets, error: null })
      q.then = (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject)
      return q
    },
  }
  const filename = path.resolve(__dirname, '../app/api/invite-user/route.ts')
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = module.paths
  let clients = 0
  mod.require = name => name === '@/lib/device-session-server' ? { requireUnlocked: async () => options.unlocked !== false }
    : name === '@/lib/permissions' ? permissions
    : name === '@supabase/supabase-js' ? { createClient: () => ++clients === 1 ? admin : { auth: { resetPasswordForEmail: async (email, args) => { record('send', { email, ...args }); return { error: options.sendError || null } } } } }
    : require(name)
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename)
  const post = (changes = {}, bearer = 'token') => mod.exports.POST(new Request('https://www.rejoyceapp.com/api/invite-user', {
    method: 'POST', headers: { ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...changes }),
  }))
  return { post, calls }
}

test('locked, unauthenticated, inactive and unauthorized callers cannot send invitations', async () => {
  for (const options of [{ unlocked: false }, { unauthenticated: true }, { caller: { status: 'inactive' } }, { caller: { role: 'staff' } }]) {
    const h = load(options)
    assert.ok([401, 403].includes((await h.post()).status))
    assert.equal(h.calls.some(c => ['send', 'invite', 'generateLink'].includes(c[0])), false)
  }
  assert.equal((await load().post({}, null)).status, 401)
})

test('resend sends once to verified account without changing its profile or generating unused links', async () => {
  const h = load()
  const response = await h.post({ fullName: 'Tampered name', role: 'manager' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).role, 'staff')
  assert.deepEqual(h.calls.filter(c => c[0] === 'getUserById'), [['getUserById', 'target']])
  assert.equal(h.calls.filter(c => c[0] === 'send').length, 1)
  assert.equal(h.calls.some(c => ['upsert', 'update', 'invite', 'generateLink'].includes(c[0])), false)
})

test('resend authorizes stored admin role even when submitted role says staff', async () => {
  for (const role of ['manager', 'director']) {
    const h = load({ caller: { role }, targets: [{ ...target, role: 'admin' }] })
    assert.equal((await h.post()).status, 403)
    assert.equal(h.calls.some(c => c[0] === 'getUserById' || c[0] === 'send'), false)
  }
})

test('resend cannot manage self or owner accounts', async () => {
  for (const changed of [{ id: caller.id }, { role: 'owner' }]) {
    const h = load({ targets: [{ ...target, ...changed }] })
    assert.equal((await h.post()).status, 403)
    assert.equal(h.calls.some(c => c[0] === 'send'), false)
  }
})

test('cross-organization requests and targets are rejected before email operations', async () => {
  const h = load()
  assert.equal((await h.post({ organizationId: 'other' })).status, 403)
  const other = load({ targets: [{ ...target, organization_id: 'other' }] })
  assert.equal((await other.post()).status, 409)
  assert.equal(other.calls.some(c => c[0] === 'send'), false)
})

test('missing resend target never falls through to account creation', async () => {
  const h = load({ targets: [] })
  assert.equal((await h.post()).status, 404)
  assert.equal(h.calls.some(c => ['invite', 'listUsers', 'upsert', 'send'].includes(c[0])), false)
})

test('ambiguous profile lookup fails closed', async () => {
  const h = load({ targets: [target, { ...target, id: 'second' }] })
  assert.equal((await h.post()).status, 409)
  assert.equal(h.calls.some(c => c[0] === 'send'), false)
})

test('valid email wildcard characters are escaped in profile lookup', async () => {
  const h = load({ targets: [] })
  await h.post({ email: ' A_B%tag@example.com ' })
  assert.deepEqual(h.calls.find(c => c[0] === 'ilike'), ['ilike', ['email', 'a\\_b\\%tag@example.com']])
})

test('auth identity mismatch and missing auth accounts never send setup email', async () => {
  for (const authTarget of [null, { email: 'other@example.com' }]) {
    const h = load({ authTarget })
    assert.ok([404, 409].includes((await h.post()).status))
    assert.equal(h.calls.some(c => c[0] === 'send'), false)
  }
})

test('email provider failure is returned without a profile mutation', async () => {
  const h = load({ sendError: { message: 'Rate limited' } })
  assert.equal((await h.post()).status, 400)
  assert.equal(h.calls.some(c => c[0] === 'update'), false)
})

test('incomplete Auth directory scan fails closed rather than creating an account', async () => {
  const h = load({ targets: [], fullDirectory: true })
  assert.equal((await h.post({ resend: false })).status, 500)
  assert.equal(h.calls.filter(c => c[0] === 'listUsers').length, 10)
  assert.equal(h.calls.some(c => c[0] === 'invite'), false)
})

test('new invitations still create one profile and default permissions', async () => {
  const h = load({ targets: [] })
  assert.equal((await h.post({ resend: false })).status, 200)
  assert.equal(h.calls.filter(c => c[0] === 'invite').length, 1)
  assert.equal(h.calls.filter(c => c[0] === 'upsert').length, 2)
})
