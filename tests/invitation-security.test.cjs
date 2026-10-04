const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const permissions = require('./helpers/load-ts.cjs')('lib/permissions.ts')
const invitationEmail = require('./helpers/load-ts.cjs')('lib/invitation-email.ts')

const caller = { id: 'caller', organization_id: 'org', role: 'owner', status: 'active' }
const target = { id: 'target', organization_id: 'org', role: 'staff', status: 'active', email: 'staff@example.com', full_name: 'Staff' }
const body = { fullName: 'Staff', email: target.email, role: 'staff', organizationId: 'org', resend: true }

function load(options = {}) {
  const calls = []
  const record = (name, value) => calls.push([name, value])
  const reservations = options.reservations || new Map()
  const admin = {
    rpc: async (name, args) => {
      record('rpc', { name, args })
      if (name === 'organization_write_access') return { data: options.canWrite !== false, error: options.accessError || null }
      if (options.reservationError) return { data: null, error: options.reservationError }
      if (name === 'defer_invitation_email') {
        if (options.deferThrows) throw new Error('Database timeout')
        if (args.p_project) reservations.set('project', Date.now() + 3600000)
        return { data: null, error: null }
      }
      if (options.reservationData !== undefined) return { data: options.reservationData, error: null }
      const project = (reservations.get('project') || 0) > Date.now()
      const until = reservations.get(project ? 'project' : args.p_key) || 0
      if (until > Date.now()) return { data: { allowed: false, project, retry_after: Math.ceil((until-Date.now())/1000) }, error: null }
      reservations.set(args.p_key, Date.now() + 600000)
      return { data: { allowed: true }, error: null }
    },
    auth: {
      getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: caller.id } }, error: null }),
      admin: {
        getUserById: async id => { record('getUserById', id); return { data: { user: options.authTarget === undefined ? { email: target.email } : options.authTarget }, error: null } },
        generateLink: async args => { record('generateLink', args); return { data: {}, error: null } },
        listUsers: async args => { record('listUsers', args); return { data: { users: options.fullDirectory ? Array(1000).fill({ email: 'other@example.com' }) : [] }, error: null } },
        inviteUserByEmail: async email => { record('invite', email); if (options.sendPromise) await options.sendPromise; if (options.inviteThrow) throw new Error('Network timeout'); return { data: { user: options.inviteError ? null : { id: 'new-user' } }, error: options.inviteError || null } },
      },
    },
    from: table => {
      record('from', table)
      const q = {}
      for (const method of ['select', 'eq', 'ilike', 'upsert', 'update']) {
        q[method] = (...args) => { record(method, args); return q }
      }
      q.single = async () => ({ data: { ...caller, ...options.caller }, error: null })
      q.maybeSingle = async () => ({ data: options.grants === undefined ? { can_manage_users: false } : options.grants, error: options.grantsError || null })
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
  mod.require = name => name === '@/lib/device-session-server' ? { requireUnlocked: async () => options.unlocked === false ? null : {user:{id:caller.id}} }
    : name === '@/lib/permissions' ? permissions
    : name === '@/lib/invitation-email' ? invitationEmail
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

test('expired organization and access-check failure never send an invitation', async () => {
  for (const options of [{canWrite:false},{accessError:{message:'offline'}}]) {
    const h=load(options)
    assert.ok([403,503].includes((await h.post()).status))
    assert.equal(h.calls.some(c=>['send','invite','generateLink'].includes(c[0])),false)
  }
})

test('resend authorizes stored admin role even when submitted role says staff', async () => {
  for (const role of ['manager', 'director']) {
    const h = load({ caller: { role }, grants: { can_manage_users: true }, targets: [{ ...target, role: 'admin' }] })
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

test('every non-owner role needs an explicit current Manage users grant for invite and resend', async () => {
  for (const role of ['admin', 'manager', 'director', 'teacher', 'staff']) {
    for (const resend of [false, true]) {
      const options = { caller: { role }, targets: resend ? [target] : [] }
      for (const grants of [null, {}, { can_manage_users: false }, { can_manage_users: 'true' }]) {
        const h = load({ ...options, grants })
        assert.equal((await h.post({ resend })).status, 403)
        assert.equal(h.calls.some(c => ['send', 'invite'].includes(c[0])), false)
      }
      const h = load({ ...options, grants: { can_manage_users: true } })
      assert.equal((await h.post({ resend })).status, 200)
      assert.ok(h.calls.some(c => c[0] === 'eq' && c[1][0] === 'organization_id' && c[1][1] === 'org'))
    }
  }
})

test('permission lookup failures deny invitations even when the returned grant is true', async () => {
  const h = load({ caller: { role: 'admin' }, grants: { can_manage_users: true }, grantsError: {} })
  assert.equal((await h.post()).status, 403)
  assert.equal(h.calls.some(c => c[0] === 'send'), false)
})

test('Supabase email-limit errors return a clear wait and Retry-After on invite and resend', async () => {
  for (const resend of [false, true]) {
    const error = { status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' }
    const h = load({ targets: resend ? [target] : [], inviteError: error, sendError: error })
    const response = await h.post({ resend })
    assert.equal(response.status, 429)
    assert.equal(response.headers.get('Retry-After'), '3600')
    const result = await response.json()
    assert.equal(result.code, 'EMAIL_SEND_RATE_LIMIT')
    assert.match(result.error, /wait up to 60 minutes/)
    assert.equal(h.calls.some(c => c[0] === 'upsert'), false)
    assert.equal(h.calls.filter(c => c[0] === 'rpc' && c[1].name === 'defer_invitation_email').length, 1)
  }
})

test('independent route instances share a recipient reservation across invite and resend', async () => {
  const reservations = new Map()
  const first = load({ targets: [], reservations })
  const second = load({ reservations })
  assert.equal((await first.post({ resend: false, email: ' STAFF@example.com ' })).status, 200)
  const response = await second.post()
  assert.equal(response.status, 429)
  assert.equal((await response.json()).code, 'INVITATION_COOLDOWN')
  assert.equal(second.calls.some(c => c[0] === 'send'), false)
})

test('overlapping requests send only one email across server instances', async () => {
  const reservations = new Map()
  let release
  const sendPromise = new Promise(resolve => { release = resolve })
  const first = load({ targets: [], reservations, sendPromise })
  const second = load({ targets: [], reservations })
  const pending = first.post({ resend: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await second.post({ resend: false })).status, 429)
  release()
  assert.equal((await pending).status, 200)
  assert.equal([...first.calls, ...second.calls].filter(c => c[0] === 'invite').length, 1)
})

test('reservation failures and malformed results fail closed without sending', async () => {
  for (const options of [{ reservationError: {} }, { reservationData: null }, { reservationData: { allowed: false } }]) {
    for (const resend of [true, false]) {
      const h = load({ ...options, targets: resend ? [target] : [] })
      assert.equal((await h.post({ resend })).status, 503)
      assert.equal(h.calls.some(c => ['invite', 'send', 'upsert'].includes(c[0])), false)
    }
  }
})

test('project backoff blocks a different recipient after an email-limit error', async () => {
  const reservations = new Map()
  const first = load({ targets: [], reservations, inviteError: { code: 'over_email_send_rate_limit', status: 429 } })
  assert.equal((await first.post({ resend: false })).status, 429)
  const second = load({ targets: [], reservations })
  const response = await second.post({ resend: false, email: 'someoneelse@example.com' })
  assert.equal(response.status, 429)
  assert.equal((await response.json()).code, 'EMAIL_SEND_RATE_LIMIT')
  assert.equal(second.calls.some(c => c[0] === 'invite'), false)
})

test('ambiguous send timeout retains cooldown and creates no profile', async () => {
  const reservations = new Map()
  const first = load({ targets: [], reservations, inviteThrow: true })
  assert.equal((await first.post({ resend: false })).status, 500)
  const second = load({ targets: [], reservations })
  assert.equal((await second.post({ resend: false })).status, 429)
  assert.equal(second.calls.some(c => c[0] === 'invite'), false)
  assert.equal(first.calls.some(c => c[0] === 'upsert'), false)
})

test('authorization and account mismatch failures do not consume reservations', async () => {
  for (const options of [{ unlocked: false }, { caller: { role: 'staff' } }, { authTarget: { email: 'other@example.com' } }, { targets: [{ ...target, organization_id: 'other' }] }]) {
    const h = load(options)
    await h.post()
    assert.equal(h.calls.some(c => c[0] === 'rpc' && c[1].name === 'reserve_invitation_email'), false)
  }
})

test('backoff persistence failure still returns the provider wait and retains recipient claim', async () => {
  const reservations = new Map()
  const h = load({ targets: [], reservations, deferThrows: true, inviteError: { code: 'over_email_send_rate_limit', status: 429 } })
  const response = await h.post({ resend: false })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '3600')
  assert.equal((await load({ targets: [], reservations }).post({ resend: false })).status, 429)
})
