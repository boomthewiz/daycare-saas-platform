const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

function loadTs(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", output)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const branchHelpers = loadTs("lib/branches.ts")
const branches = [{ id: "north", name: "North", active: true }, { id: "south", name: "South", active: true }, { id: "old", name: "Old", active: false }]

function harness(selectedBranchId = "north") {
  const React = require("react")
  const values = []; const memos = []; const effectDeps = []; let index = 0; let effects = []
  const same = (a,b) => a && b && a.length === b.length && a.every((value,i) => Object.is(value,b[i]))
  const mockReact = { ...React,
    useState(initial) {
      const slot = index++
      if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial
      return [values[slot], value => { values[slot] = typeof value === "function" ? value(values[slot]) : value }]
    },
    useMemo(fn, deps) {
      const slot = index++
      if (!same(memos[slot]?.deps, deps)) memos[slot] = { deps, value: fn() }
      return memos[slot].value
    },
    useCallback(fn,deps) { return mockReact.useMemo(() => fn,deps) },
    useEffect(fn,deps) {
      const slot = index++
      if (!same(effectDeps[slot],deps)) { effectDeps[slot] = deps; effects.push(fn) }
    },
  }
  const context = { branches, selectedBranchId, loading:false, error:null }
  const calls = []; const routes = []
  const supabase = {
    from(table) {
      const query = { select() { return query }, order() { return query }, then(resolve,reject) {
        return Promise.resolve({data:[],error:null}).then(resolve,reject)
      }}
      return query
    },
    async rpc(name,args) {
      calls.push({name,args})
      return {data:name === "can_manage_clients" ? true : "new-client",error:null}
    },
  }
  function ClientBranchPicker() { return null }
  const Component = loadTs("app/(dashboard)/team-management/page.tsx", {
    "@/components/SubscriptionWriteControls": { default: ({ children }) => children },
    react:mockReact,
    "@/lib/supabase":{supabase},
    "next/navigation":{useRouter:() => ({push:route => routes.push(route)})},
    "next/link":{default:() => null},
    "@/components/BranchProvider":{useBranches:() => context},
    "@/components/ClientBranchPicker":{default:ClientBranchPicker},
    "@/lib/branches":branchHelpers,
  }).default
  function render() { index=0; return Component() }
  function all(node,predicate,result=[]) {
    if (Array.isArray(node)) { node.forEach(child => all(child,predicate,result)); return result }
    if (!node || typeof node !== "object") return result
    if (predicate(node)) result.push(node)
    if (node.props) all(node.props.children,predicate,result)
    return result
  }
  async function ready() {
    render()
    const queued=effects; effects=[]
    queued.forEach(effect => effect())
    await new Promise(resolve => setImmediate(resolve))
    return render()
  }
  const text = node => !node ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children)
  function add(tree) { all(tree,n => n.type === "button" && text(n).includes("Add Client"))[0].props.onClick() }
  function picker(tree) { return all(tree,n => n.type === ClientBranchPicker)[0] }
  return { ready,render,all,add,picker,context,calls,routes }
}

test("new client defaults to the selected branch; manual multiple selections survive a workspace switch", async () => {
  const h=harness()
  let tree=await h.ready()
  h.add(tree); tree=h.render()
  assert.deepEqual(h.picker(tree).props.value,["north"])
  h.picker(tree).props.onChange(["north","south"])
  h.context.selectedBranchId="south"
  tree=h.render()
  assert.deepEqual(h.picker(tree).props.value,["north","south"])
  const form=h.all(tree,n=>n.type==="form")[0]
  h.all(form,n=>n.type==="input")[0].props.onChange({target:{value:"Synthetic"}})
  tree=h.render()
  await h.all(tree,n=>n.type==="form")[0].props.onSubmit({preventDefault(){}})
  assert.deepEqual(h.calls.find(c=>c.name==="create_client_with_locations").args.p_location_ids,["north","south"])
  assert.deepEqual(h.routes,["/clients/new-client"])
})

test("all-branches view does not silently assign a client to every branch", async () => {
  const h=harness("")
  let tree=await h.ready(); h.add(tree); tree=h.render()
  assert.deepEqual(h.picker(tree).props.value,[])
  const submit=h.all(tree,n=>n.type==="button" && n.props.type==="submit")[0]
  assert.equal(submit.props.disabled,true)
})

test("stale, inactive, or foreign saved defaults are ignored and preferences are account/company scoped", () => {
  for(const id of ["old","foreign",null]) {
    assert.equal(branchHelpers.validBranchSelection(id,branches),"")
    assert.deepEqual(branchHelpers.initialClientBranches(id || "",branches),[])
  }
  assert.notEqual(branchHelpers.branchStorageKey("user-a","org-a"),branchHelpers.branchStorageKey("user-b","org-a"))
  assert.notEqual(branchHelpers.branchStorageKey("user-a","org-a"),branchHelpers.branchStorageKey("user-a","org-b"))
})
