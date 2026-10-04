const { test } = require('node:test')
const assert = require('node:assert/strict')
const { eligibleStaff, selectPeople, groupSelection } = require('./helpers/load-ts.cjs')('lib/care-team.ts')

test('overlapping groups deduplicate and individual exclusions apply everywhere', () => {
  let selected = selectPeople([], ['a', 'b'], true)
  selected = selectPeople(selected, ['b', 'c', 'b'], true)
  assert.deepEqual(selected, ['a', 'b', 'c'])
  selected = selectPeople(selected, ['b'], false)
  assert.deepEqual(groupSelection(['a', 'b'], selected), {count:1,total:2,all:false,partial:true})
  assert.deepEqual(groupSelection(['b', 'c'], selected), {count:1,total:2,all:false,partial:true})
  selected = selectPeople(selected, ['a', 'b'], true)
  assert.deepEqual(selected, ['a', 'c', 'b'])
  selected = selectPeople(selected, ['b', 'c'], false)
  assert.deepEqual(selected, ['a'])
})
test('empty groups are never fully selected and duplicated member IDs count once', () => {
  assert.deepEqual(groupSelection([], []), {count:0,total:0,all:false,partial:false})
  assert.deepEqual(groupSelection(['a','a'], ['a']), {count:1,total:1,all:true,partial:false})
})
test('staff require active care role and a shared client branch', () => {
  const person = {id:'a',name:'A',role:'teacher',status:'active',location_ids:['north']}
  assert.equal(eligibleStaff(person, ['south']), false)
  assert.equal(eligibleStaff(person, ['south','north']), true)
  assert.equal(eligibleStaff({...person,status:'invited'}, ['north']), false)
  assert.equal(eligibleStaff({...person,role:'admin'}, ['north']), false)
  assert.equal(eligibleStaff({...person,location_ids:[]}, ['north']), false)
})
