const { test } = require('node:test')
const assert = require('node:assert/strict')
const { noteActions, noteFailure } = require('./helpers/load-ts.cjs')('lib/session-notes.ts')
const provider = { userId:'p',providerId:'p',frontline:true,reviewer:false,admin:false,sessionStatus:'completed' }
const note = status => ({status,author_id:'p',version:1})
test('active and paused sessions support drafts but never submission',()=>{
  for(const sessionStatus of ['in_progress','paused']) assert.deepEqual(noteActions(null,{...provider,sessionStatus}),['save'])
  for(const sessionStatus of ['scheduled','canceled','no_show','provider_absent','client_absent']) assert.deepEqual(noteActions(null,{...provider,sessionStatus}),[])
  assert.deepEqual(noteActions(null,provider),['save','submit'])
})
test('only assigned frontline authors edit drafts or returned notes',()=>{
  for(const status of ['draft','returned']) {
    assert.deepEqual(noteActions(note(status),provider),['save','submit'])
    assert.deepEqual(noteActions({...note(status),author_id:'other'},provider),[])
    assert.deepEqual(noteActions(note(status),{...provider,providerId:'other'}),[])
    assert.deepEqual(noteActions(note(status),{...provider,frontline:false}),[])
  }
  for(const status of ['submitted','approved','locked']) assert.deepEqual(noteActions(note(status),provider),[])
})
test('reviewers may return submitted notes, approve, or lock; never revert or unlock',()=>{
  const reviewer={...provider,frontline:false,reviewer:true}
  assert.deepEqual(noteActions(note('submitted'),reviewer),['return','approve','lock'])
  assert.deepEqual(noteActions(note('approved'),reviewer),['lock'])
  assert.deepEqual(noteActions(note('locked'),reviewer),[])
})
test('owner/admin special authority does not silently grant review permissions',()=>{
  const admin={...provider,frontline:false,admin:true}
  assert.deepEqual(noteActions(note('approved'),admin),['revert_approval'])
  assert.deepEqual(noteActions(note('locked'),admin),['unlock'])
  assert.deepEqual(noteActions(note('submitted'),admin),[])
})
test('conflict and session expiry messages preserve unsaved work',()=>{
  assert.match(noteFailure({code:'40001'}),/text is still here/)
  assert.match(noteFailure({code:'42501'}),/Unlock or sign in/)
  assert.match(noteFailure(null),/Retry the same request/)
})
