/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node test harness, consistent with tests/helpers. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-ts.cjs')
const { parseCsv, validateImportRows, csvReport } = load('lib/people-import.ts')
const { defaultTerms, vocabularyPresets, translatePortalText } = load('lib/portal-presets.ts')

test('CSV handles BOM, CRLF, commas and escaped quotes without losing columns', () => {
  assert.deepEqual(parseCsv('\uFEFFid,name\r\n1,"Alex, ""Ace"""\r\n2,Blair'), [['id','name'],['1','Alex, "Ace"'],['2','Blair']])
  for (const source of ['id,name\n1,"unfinished','id,id\n1,2','id,name','id,name\n1,a"b','id,name\n1,"a"b']) assert.throws(()=>parseCsv(source))
  assert.throws(()=>parseCsv('id\n'+Array.from({length:101},(_,i)=>i).join('\n')),/100/)
  assert.throws(()=>parseCsv('x'.repeat(1024*1024+1)),/1 MB/)
})
test('mapping and row validation prevent missing, duplicated, oversized and elevated imports', () => {
  const csv = parseCsv('id,first,last\nC1,Sam,Example\nC1,Other,Example\nC2,,Example\nC3,Jo')
  const map = {external_id:0,first_name:1,last_name:2,preferred_name:-1}
  assert.deepEqual(validateImportRows(csv,'clients',map).map(row=>!!row.error),[false,true,true,true])
  assert.throws(()=>validateImportRows(csv,'clients',{external_id:0,first_name:0}),/only one/)
  assert.throws(()=>validateImportRows(csv,'clients',{external_id:-1,first_name:1}),/required/)
  const staff = parseCsv('name,email,role\nAlex,ALEX@example.invalid,teacher\nJo,alex@example.invalid,staff\nMax,max@example.invalid,admin\nBad,noemail,teacher')
  const rows = validateImportRows(staff,'staff',{full_name:0,email:1,role:2})
  assert.equal(rows[0].values.email,'alex@example.invalid')
  assert.deepEqual(rows.map(row=>!!row.error),[false,true,true,true])
  assert.match(rows[2].error,/individually/)
})
test('row reports escape spreadsheet formulas and quoted errors', () => {
  assert.equal(csvReport([{row:2,status:'=1+1'},{row:3,status:'Error "quoted"'}]),'row,status\r\n2,"\'=1+1"\r\n3,"Error ""quoted"""')
})
test('vocabulary supports case and plural forms without recursive replacement or changing substrings', () => {
  const education = vocabularyPresets.find(preset=>preset.id==='education').terms
  assert.equal(translatePortalText('Clients: create a session with Team Members and targets.',education),'Students: create a lesson with Teachers and goals.')
  assert.equal(translatePortalText('Client session_id client_id Sessions',education),'Student session_id client_id Lessons')
  assert.equal(translatePortalText('Clients', {...defaultTerms,client_plural:'Session Clients'}),'Session Clients')
})
