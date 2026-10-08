const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const helpers = require('./helpers/load-ts.cjs')('lib/care-team.ts')
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/CareTeamPicker.tsx'),'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
}).outputText
const mod = {exports:{}}
new Function('require','module','exports',output)(name=>{
  if(name==='@/components/PortalProvider')return {usePortal:()=>({t:text=>text})}
  if(name==='@/lib/care-team')return helpers
  if(name==='next/link')return {default:({children,...props})=>React.createElement('a',props,children)}
  return require(name)
},mod,mod.exports)
const Picker = mod.exports.default
const context = {staff:[
  {id:'a',name:'Alex',role:'teacher',status:'active',location_ids:['north']},
  {id:'b',name:'Blair',role:'aide',status:'active',location_ids:['north']},
  {id:'c',name:'Casey',role:'teacher',status:'active',location_ids:['south']},
],groups:[{id:'g',name:'Sunshine',kind:'class',location_id:'north',member_ids:['a','b'],version:0}],member_ids:[],location_ids:[],primary_id:null,version:null}
function all(node,predicate,result=[]) {
  if(Array.isArray(node)){node.forEach(child=>all(child,predicate,result));return result}
  if(!node||typeof node!=='object')return result
  if(predicate(node))result.push(node)
  if(node.props)all(node.props.children,predicate,result)
  return result
}
test('pre-save summary identifies unique people and partial groups; default removal clears scheduling choice',()=>{
  let change
  const props={context,locationIds:['north'],selected:['a','a'],primaryId:'a',onChange:(...args)=>{change=args}}
  const html=renderToStaticMarkup(React.createElement(Picker,props))
  assert.match(html,/Assignment summary — 1 person/)
  assert.match(html,/aria-checked="mixed"/)
  assert.match(html,/partially selected/)
  assert.match(html,/Default worker: Alex/)
  const tree=Picker(props)
  const boxes=all(tree,node=>node.type==='input'&&node.props.type==='checkbox')
  boxes.find(node=>node.props.checked===true&&node.props['aria-checked']===undefined).props.onChange({target:{checked:false}})
  assert.deepEqual(change,[[], ''])
})
test('whole-group selection resolves explicit eligible IDs and unavailable choices stay removable',()=>{
  let change
  const props={context,locationIds:['north'],selected:['c'],primaryId:'c',onChange:(...args)=>{change=args}}
  const tree=Picker(props)
  const boxes=all(tree,node=>node.type==='input'&&node.props.type==='checkbox')
  boxes.find(node=>node.props['aria-checked']!==undefined).props.onChange({target:{checked:true}})
  assert.deepEqual(change,[['c','a','b'],'c'])
  const html=renderToStaticMarkup(React.createElement(Picker,props))
  assert.match(html,/Some selected people are unavailable/)
  assert.match(html,/Casey/)
  const unavailable=boxes.find(node=>node.props.checked===true)
  assert.equal(unavailable.props.disabled,false)
  unavailable.props.onChange({target:{checked:false}})
  assert.deepEqual(change,[[], ''])
})
