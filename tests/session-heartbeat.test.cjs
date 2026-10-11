/* eslint-disable @typescript-eslint/no-require-imports -- Isolated component lifecycle harness. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const ts = require('typescript')

function guard() {
  let now = 1000, interval, effect, stateIndex = 0, refIndex = 0
  const pending = [], refs = []
  const events = {}, calls = [], values = []
  let delay = false, hidden = false
  const state = () => ({ state: 'unlocked', serverNow: new Date(now).toISOString(), unlockedUntil: new Date(now + 300000).toISOString(), fullAuthUntil: new Date(now + 86400000).toISOString(), pinRequiredBy: new Date(now + 86400000).toISOString() })
  const jsx = (type, props) => ({ type, props })
  const context = {
    exports: {}, URL, Date, performance: { now: () => now },
    window: { location: { href: 'https://example.invalid/dashboard', assign: () => calls.push('redirect') }, setTimeout: fn => fn(), setInterval: fn => { interval = fn; return 1 }, clearInterval() {}, addEventListener: (name, fn) => { events[name] = fn }, removeEventListener() {} },
    document: { get hidden() { return hidden }, addEventListener: (name, fn) => { events[name] = fn }, removeEventListener() {} },
    fetch: async () => { calls.push('policy'); return { ok: true, json: async () => ({ enabled: true }) } },
    require: name => name === 'react' ? { useRef: value => { const index = refIndex++; return refs[index] || (refs[index] = { current: value }) }, useState: value => { const index = stateIndex++; if (values.length <= index) values[index] = value; return [values[index], next => { values[index] = next }] }, useCallback: fn => fn, useEffect: fn => { effect = fn } }
      : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'fragment' }
      : name === 'next/navigation' ? { usePathname: () => '/dashboard' }
      : name === '@/lib/supabase' ? { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'synthetic' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) } } }
      : name === '@/lib/device-session-client' ? { sessionRequest: async action => { calls.push(action); if (delay) await new Promise(resolve => { pending.push(resolve) }); return action === 'lock' ? { state: 'locked' } : state() } }
      : { default: () => null },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/SessionGuard.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, context)
  const render = () => { stateIndex = 0; refIndex = 0; return context.exports.default({ children: null }) }
  render()
  const cleanup = effect()
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  return { calls, values, cleanup, flush, render, tick: async ms => { now += ms; interval(); await flush() }, activity: async (trusted = true) => { events.keydown({ isTrusted: trusted }); await flush() }, hide: async value => { hidden = value; events.visibilitychange(); await flush() }, delay: () => { delay = true }, resolve: async () => { delay = false; pending.splice(0).forEach(resolve => resolve()); await flush() } }
}

test('typing pauses cannot bypass one-minute renewal limit; renewals replace polling', async () => {
  const h = guard(); await h.flush()
  for (let i = 0; i < 120; i++) { await h.activity(); await h.tick(2000) }
  assert.equal(h.calls.filter(x => x === 'activity').length, 4)
  assert.equal(h.calls.filter(x => x === 'status').length, 1)
  assert.equal(h.values[0], 'unlocked')
  h.cleanup()
})
test('untrusted events and unattended polling never renew; five-minute expiry locks', async () => {
  const h = guard(); await h.flush()
  for (let i = 0; i < 5; i++) { await h.activity(false); await h.tick(60000) }
  assert.equal(h.calls.includes('activity'), false)
  assert.equal(h.values[0], 'locked')
  assert.equal(h.values[1], true) // workspace stays mounted to preserve unsaved work
  h.cleanup()
})
test('hidden tabs stop requests and lock on return after five minutes', async () => {
  const h = guard(); await h.flush(); await h.hide(true)
  await h.activity(); await h.tick(300000); await h.hide(false)
  assert.equal(h.calls.includes('activity'), false)
  assert.equal(h.values[0], 'locked')
  h.cleanup()
})
test('slow heartbeat cannot overlap polling or reopen a subsequently locked page', async () => {
  const h = guard(); await h.flush(); h.delay()
  await h.tick(59000); await h.activity(); await h.tick(2000)
  assert.equal(h.calls.filter(x => x === 'activity').length, 1)
  await h.tick(300000) // lock supersedes the pending renewal
  await h.resolve()
  assert.equal(h.values[0], 'locked')
  h.cleanup()
})


test('sign-out hides workspace immediately and rejects a late heartbeat response', async () => {
  const h = guard(); await h.flush(); h.delay()
  await h.tick(59000); await h.activity(); await h.tick(2000)
  const tree = h.render()
  const find = node => {
    if (!node || typeof node !== 'object') return null
    if (node.type === 'button' && node.props.children === 'Sign out') return node
    for (const child of [node.props?.children].flat()) { const found = find(child); if (found) return found }
    return null
  }
  const button = find(tree); assert.ok(button)
  const signingOut = button.props.onClick()
  await h.flush()
  assert.equal(h.values[2], true)
  const count = h.calls.length
  await h.tick(60000); await h.activity()
  assert.equal(h.calls.length, count)
  await h.resolve(); await signingOut
  assert.equal(h.values[1], false)
  assert.ok(h.calls.includes('redirect'))
  h.cleanup()
})
