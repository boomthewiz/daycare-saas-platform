const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

// Exercise the actual route handlers with isolated Auth/database adapters.
function handler(route, options = {}) {
  const calls = []
  const rows = [...(options.rows || [])]
  const admin = {
    rpc: async (name, args) => {
      calls.push(['rpc', name, args])
      if (options.limitThrows) throw new Error('private backend error')
      return options.limit || { data: [{ allowed: true, retry_after: 0, attempt_id: 'reserved-attempt' }], error: null }
    },
    auth: {
      getUser: async token => {
        calls.push(['getUser', token])
        return options.auth || { data: { user: { id: 'verified-user' } }, error: null }
      },
      admin: {
        generateLink: async args => {
          calls.push(['generateLink', args])
          return { data: { properties: { action_link: 'https://example.invalid/login' } }, error: null }
        },
      },
    },
    from: table => {
      calls.push(['from', table])
      const query = {}
      for (const method of ['select', 'eq', 'update', 'delete']) {
        query[method] = (...args) => { calls.push([method, ...args]); return query }
      }
      query.single = async () => {
        if (!rows.length) throw new Error('Unexpected database call')
        return rows.shift()
      }
      return query
    },
  }
  const bcrypt = {
    hash: async () => { calls.push(['hash']); return 'synthetic-hash' },
    compare: async () => { calls.push(['compare']); return options.matches !== false },
  }
  const filename = path.resolve(__dirname, '..', 'app', 'api', route, 'route.ts')
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = module.paths
  mod.require = name => name === '@/lib/supabase-admin' ? { supabaseAdmin: admin }
    : name === '@/lib/device-session-server' ? {
      verifiedIdentity: async req => {
        if (!req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)) return null
        if (options.auth?.error || options.identity === null) return null
        return { user: { id: 'verified-user' }, sessionId: 'fixture-session' }
      },
      deviceState: async () => options.device || { state: 'unlocked', canSetPin: true },
    } : name === 'bcryptjs' ? bcrypt : require(name)
  mod._compile(compiled, filename)
  return { ...mod.exports, calls }
}

const row = data => ({ data, error: null })
function request(body, authorization = 'Bearer valid-token', query = '') {
  return new Request('https://example.invalid/api/test' + query, {
    method: body === undefined ? 'GET' : 'POST',
    headers: authorization ? { authorization, 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

test('PIN status requires a valid bearer token before reading the database', async () => {
  for (const token of [null, 'Basic token', 'Bearer ', 'Bearer token extra']) {
    const h = handler('pin-status')
    assert.equal((await h.GET(request(undefined, token))).status, 401)
    assert.deepEqual(h.calls, [])
  }
  const h = handler('pin-status', { auth: { data: { user: null }, error: { message: 'invalid' } } })
  assert.equal((await h.GET(request())).status, 401)
  assert.equal(h.calls.some(c => c[0] === 'from'), false)
})

test('PIN status returns only booleans for the verified identity and cannot be cached', async () => {
  const h = handler('pin-status', { rows: [row({ status: 'active', pin_hash: 'sensitive-synthetic-hash', pin_reset_required: true })] })
  const res = await h.GET(request(undefined, 'Bearer valid-token', '?userId=victim'))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await res.json(), { hasPin: true, resetRequired: true })
  assert.ok(h.calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === 'verified-user'))
  assert.equal(h.calls.some(c => c.includes('victim')), false)
})

test('PIN status reports an unset PIN without revealing the profile', async () => {
  const h = handler('pin-status', { rows: [row({ status: 'active', pin_hash: null, pin_reset_required: false })] })
  assert.deepEqual(await (await h.GET(request())).json(), { hasPin: false, resetRequired: false })
})

test('PIN status fails closed for inactive accounts and database errors', async () => {
  const inactive = handler('pin-status', { rows: [row({ status: 'disabled', pin_hash: 'secret' })] })
  assert.equal((await inactive.GET(request())).status, 403)
  const failed = handler('pin-status', { rows: [{ data: null, error: { message: 'secret database detail' } }] })
  const res = await failed.GET(request())
  assert.equal(res.status, 503)
  assert.equal((await res.text()).includes('secret'), false)
})

test('PIN setup validates four numeric digits before hashing', async () => {
  for (const pin of [1234, null, {}, ['1','2','3','4'], 'abcd', '123', '12345']) {
    const h = handler('set-pin')
    assert.equal((await h.POST(request({ pin }))).status, 400)
    assert.deepEqual(h.calls, [])
  }
})

test('PIN setup rejects invalid authentication and inactive users', async () => {
  const missing = handler('set-pin')
  assert.equal((await missing.POST(request({ pin: '1234' }, null))).status, 401)
  const expired = handler('set-pin', { auth: { data: { user: null }, error: { message: 'expired' } } })
  assert.equal((await expired.POST(request({ pin: '1234' }))).status, 401)
  const inactive = handler('set-pin', { rows: [row({ status: 'disabled' })] })
  assert.equal((await inactive.POST(request({ pin: '1234' }))).status, 403)
  assert.equal(inactive.calls.some(c => c[0] === 'hash' || c[0] === 'update'), false)
})

test('PIN setup clears reset state and only updates the active verified user', async () => {
  const h = handler('set-pin', { rows: [row({ status: 'active' }), row({ id: 'verified-user' })] })
  const res = await h.POST(request({ pin: '1234', userId: 'victim' }))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { success: true })
  assert.ok(h.calls.some(c => c[0] === 'update' && c[1].pin_hash === 'synthetic-hash' && c[1].pin_reset_required === false))
  assert.ok(h.calls.some(c => c[0] === 'eq' && c[1] === 'status' && c[2] === 'active'))
  assert.equal(h.calls.some(c => c.includes('victim')), false)
})

test('PIN setup does not report success when no active row was updated', async () => {
  const h = handler('set-pin', { rows: [row({ status: 'active' }), { data: null, error: { message: 'private detail' } }] })
  const res = await h.POST(request({ pin: '1234' }))
  assert.equal(res.status, 500)
  assert.equal((await res.text()).includes('private detail'), false)
})


test('PIN setup cannot bypass a lock without recent full email authentication', async () => {
  for (const device of [{ state: 'full_login' }, { state: 'locked', canSetPin: false }, { state: 'inactive', canSetPin: true }]) {
    const h = handler('set-pin', { device })
    const res = await h.POST(request({ pin: '1234' }))
    assert.equal(res.status, 401)
    assert.equal(h.calls.some(c => c[0] === 'hash' || c[0] === 'update'), false)
  }
})

test('legacy PIN endpoint can never mint a new full-authentication session', async () => {
  const h = handler('staff-login')
  const res = await h.POST(request({ username: 'fixture', pin: '1234' }))
  assert.equal(res.status, 401)
  assert.deepEqual(h.calls, [])
})
