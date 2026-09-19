const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const userId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const token = 'verified.' + Buffer.from(JSON.stringify({ sub: userId, session_id: sessionId })).toString('base64url') + '.signature'
const status = state => ({ state, canSetPin: true })

function load(route, options = {}) {
  const calls = []
  const states = [...(options.states || [status('locked'), status('unlocked')])]
  const admin = {
    auth: { getUser: async value => {
      calls.push(['verify', value])
      return options.auth || { data: { user: { id: userId, is_anonymous: false } }, error: null }
    } },
    rpc: async (name, args) => {
      calls.push([name, args])
      if (name === 'manage_device_session') return { data: states.shift() || status('locked'), error: options.stateError || null }
      return options.limit || { data: [{ allowed: true, retry_after: 0, attempt_id: 'attempt' }], error: null }
    },
    from: table => {
      calls.push(['from', table])
      const q = {}
      for (const method of ['select','eq','insert','delete']) q[method] = (...args) => { calls.push([method,...args]); return q }
      q.single = async () => ({ data: options.profile === undefined ? { id: userId, status: 'active', pin_hash: 'secret', pin_reset_required: false } : options.profile, error: null })
      q.then = (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject)
      return q
    },
  }
  const cache = new Map()
  function compile(file) {
    if (cache.has(file)) return cache.get(file)
    const filename = path.resolve(__dirname, '..', file)
    const mod = new Module(filename, module)
    mod.filename = filename; mod.paths = module.paths
    mod.require = name => name === '@/lib/supabase-admin' ? { supabaseAdmin: admin }
      : name === '@/lib/device-session-server' ? compile('lib/device-session-server.ts')
      : name === 'bcryptjs' ? { compare: async () => { calls.push(['compare']); return options.matches !== false } }
      : name === '@supabase/supabase-js' ? { createClient: () => ({ auth: { signInWithOtp: async args => { calls.push(['email', args]); return { error: options.emailError || null } } } }) }
      : require(name)
    mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename)
    cache.set(file, mod.exports)
    return mod.exports
  }
  return { ...compile('app/api/' + route + '/route.ts'), calls }
}
const req = (body, bearer = token) => new Request('https://www.rejoyceapp.com/api/device-session', {
  method: body === undefined ? 'GET' : 'POST', headers: { ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), 'Content-Type':'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

test('missing, invalid, anonymous and mismatched bearer identities cannot manage sessions', async () => {
  for (const options of [{ bearer: null }, { auth: { data: { user: null }, error: {} } },
    { auth: { data: { user: { id: 'other' } }, error: null } },
    { auth: { data: { user: { id: userId, is_anonymous: true } }, error: null } }]) {
    const h = load('device-session', options)
    assert.equal((await h.POST(req({action:'unlock',pin:'1234'}, options.bearer === null ? null : token))).status,401)
    assert.equal(h.calls.some(c=>c[0]==='manage_device_session'),false)
  }
})
test('untrusted or expired devices cannot use a PIN to create full authentication', async () => {
  const h=load('device-session',{states:[status('full_login')]})
  assert.equal((await h.POST(req({action:'unlock',pin:'1234'}))).status,401)
  assert.equal(h.calls.some(c=>['compare','reserve_pin_login_attempt'].includes(c[0])),false)
})
test('correct PIN unlocks only the verified session and releases only its own attempt', async () => {
  const h=load('device-session')
  const r=await h.POST(req({action:'unlock',pin:'1234',userId:'victim',sessionId:'victim'}))
  assert.equal(r.status,200); assert.equal((await r.json()).state,'unlocked')
  assert.equal(r.headers.get('cache-control'),'private, no-store')
  const changes=h.calls.filter(c=>c[0]==='manage_device_session')
  assert.equal(changes[1][1].p_action,'unlock')
  for(const c of changes) { assert.equal(c[1].p_user_id,userId); assert.equal(c[1].p_session_id,sessionId) }
  assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]==='id'&&c[2]==='attempt'))
  assert.equal(h.calls.some(c=>c[0]==='generateLink'),false)
})
test('incorrect PIN consumes its reservation and never unlocks', async () => {
  const h=load('device-session',{matches:false})
  assert.equal((await h.POST(req({action:'unlock',pin:'9999'}))).status,401)
  assert.equal(h.calls.some(c=>c[0]==='delete'),false)
  assert.equal(h.calls.filter(c=>c[0]==='manage_device_session').length,1)
})
test('parallel-admission limiter blocks before PIN comparison and exposes retry timing', async () => {
  const h=load('device-session',{limit:{data:[{allowed:false,retry_after:899}],error:null}})
  const r=await h.POST(req({action:'unlock',pin:'1234'}))
  assert.equal(r.status,429); assert.equal(r.headers.get('retry-after'),'899')
  assert.equal(h.calls.some(c=>c[0]==='compare'),false)
})
test('limiter failure cannot fall through to credential validation', async () => {
  for(const limit of [{data:null,error:{}},{data:[],error:null},{data:[{allowed:true,retry_after:0}],error:null}]) {
    const h=load('device-session',{limit})
    assert.equal((await h.POST(req({action:'unlock',pin:'1234'}))).status,503)
    assert.equal(h.calls.some(c=>c[0]==='compare'),false)
  }
})
test('deadline crossing during PIN verification still requires full login', async () => {
  const h=load('device-session',{states:[status('locked'),status('full_login')]})
  assert.equal((await (await h.POST(req({action:'unlock',pin:'1234'}))).json()).state,'full_login')
  assert.equal(h.calls.some(c=>c[0]==='delete'),false)
})
test('status polling never records activity or PIN use', async () => {
  const h=load('device-session')
  await h.GET(req())
  assert.ok(h.calls.filter(c=>c[0]==='manage_device_session').every(c=>c[1].p_action==='status'))
})
test('unknown operations are rejected before database access', async () => {
  const h=load('device-session')
  assert.equal((await h.POST(req({action:'reset_full_auth'}))).status,400)
  assert.deepEqual(h.calls,[])
})
test('email proof is hashed and sent only to the trusted session operation', async () => {
  const h=load('device-session',{states:[status('unlocked')]})
  assert.equal((await h.POST(req({action:'complete_email',proof:'a'.repeat(64)}))).status,200)
  const call=h.calls.find(c=>c[0]==='manage_device_session')[1]
  assert.equal(call.p_action,'complete_email'); assert.match(call.p_proof_hash,/^[a-f0-9]{64}$/)
  assert.notEqual(call.p_proof_hash,'a'.repeat(64))
})
test('email requests never return their proof to the requester and disable public signup', async () => {
  const h=load('email-login')
  const r=await h.POST(req({email:'person@example.invalid'}))
  assert.deepEqual(await r.json(),{success:true})
  const sent=h.calls.find(c=>c[0]==='email')[1]
  assert.equal(sent.options.shouldCreateUser,false)
  assert.match(sent.options.emailRedirectTo,/^https:\/\/www\.rejoyceapp\.com\/auth\/confirm\?proof=[a-f0-9]{64}$/)
  assert.ok(h.calls.some(c=>c[0]==='insert'&&/^[a-f0-9]{64}$/.test(c[1].proof_hash)))
})
test('unknown emails get the same public response without sending a link', async () => {
  const h=load('email-login',{profile:null})
  assert.deepEqual(await (await h.POST(req({email:'nobody@example.invalid'}))).json(),{success:true})
  assert.equal(h.calls.some(c=>c[0]==='email'),false)
})
