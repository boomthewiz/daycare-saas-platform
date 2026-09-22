const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function harness(role, delegates = false, self = false) {
  const React = require('react')
  const values = [], memos = [], effectDeps = [], calls = []
  let index = 0, effects = []
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = { ...React,
    useState(initial) { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], v => { values[slot] = typeof v === 'function' ? v(values[slot]) : v }] },
    useMemo(fn, deps) { const slot = index++; if (!same(memos[slot]?.deps, deps)) memos[slot] = { deps, value: fn() }; return memos[slot].value },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) { const slot = index++; if (!same(effectDeps[slot], deps)) { effectDeps[slot] = deps; effects.push(fn) } },
  }
  const memberId = self ? 'caller' : 'member'
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }) },
    from(table) {
      let id
      const result = () => ({ error: null, data: table === 'users'
        ? { id, role: id === 'caller' ? role : 'staff', organization_id: 'org', status: 'active', full_name: 'Example', email: 'example@example.com' }
        : table === 'user_permissions'
          ? { user_id: id, organization_id: 'org', can_manage_users: id === 'caller', can_delegate_permissions: id === 'caller' && delegates, can_manage_billing: false, can_view_reports: false }
          : [] })
      const q = { select() { return q }, eq(key, value) { if (['id', 'user_id'].includes(key)) id = value; return q },
        order() { return q }, gte() { return q }, limit() { return q },
        single: async () => result(), maybeSingle: async () => result(),
        upsert(data) { calls.push(data); return q },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
      }
      return q
    },
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../app/(dashboard)/team-management/[userId]/page.tsx'), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  const mocks = { react, '@/lib/supabase': { supabase }, 'next/navigation': { useParams: () => ({ userId: memberId }) } }
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), mod, mod.exports)
  function render() { index = 0; return mod.exports.default() }
  function all(node, predicate, found = []) {
    if (Array.isArray(node)) { node.forEach(child => all(child, predicate, found)); return found }
    if (!node || typeof node !== 'object') return found
    if (predicate(node)) found.push(node)
    all(node.props?.children, predicate, found)
    return found
  }
  const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : ''
  const toggle = (tree, label) => all(tree, n => n.props?.label === label)[0]
  const save = tree => all(tree, n => n.type === 'button' && text(n).includes('Save Permissions'))[0]
  async function ready() { render(); const pending = effects; effects = []; pending.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); return render() }
  return { ready, render, toggle, save, calls }
}

test('owners and administrators can save the delegation setting', async () => {
  for (const role of ['owner', 'admin']) {
    const h = harness(role)
    let tree = await h.ready()
    assert.equal(h.toggle(tree, 'May delegate permissions').props.disabled, false)
    h.toggle(tree, 'May delegate permissions').props.onClick()
    tree = h.render()
    await h.save(tree).props.onClick()
    assert.equal(h.calls[0].can_delegate_permissions, true)
    assert.equal(h.calls[0].user_id, 'member')
  }
})

test('manager without delegation cannot toggle or save permission grants', async () => {
  const h = harness('manager')
  let tree = await h.ready()
  assert.equal(h.toggle(tree, 'View reports').props.disabled, true)
  h.toggle(tree, 'View reports').props.onClick()
  tree = h.render()
  assert.equal(h.toggle(tree, 'View reports').props.enabled, false)
  assert.equal(h.save(tree), undefined)
  assert.equal(h.calls.length, 0)
})

test('approved manager may save normal grants but cannot toggle delegation or billing', async () => {
  const h = harness('manager', true)
  let tree = await h.ready()
  for (const label of ['May delegate permissions', 'Manage billing']) {
    assert.equal(h.toggle(tree, label).props.disabled, true)
    h.toggle(tree, label).props.onClick()
  }
  assert.equal(h.toggle(tree, 'View reports').props.disabled, false)
  h.toggle(tree, 'View reports').props.onClick()
  tree = h.render()
  await h.save(tree).props.onClick()
  assert.equal(h.calls[0].can_view_reports, true)
  assert.equal(h.calls[0].can_delegate_permissions, false)
  assert.equal(h.calls[0].can_manage_billing, false)
})

test('delegation does not unlock self-permission editing', async () => {
  const h = harness('manager', true, true)
  const tree = await h.ready()
  assert.equal(h.toggle(tree, 'May delegate permissions').props.disabled, true)
  assert.equal(h.toggle(tree, 'View reports').props.disabled, true)
  assert.equal(h.save(tree), undefined)
})
