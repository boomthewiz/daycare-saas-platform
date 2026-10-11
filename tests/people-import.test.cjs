/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node test harness, consistent with tests/helpers. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-ts.cjs')
const { parseCsv, parseTable, suggestImportMapping, importSources, validatePeopleRows, validateImportRows, invitationOutcome, csvReport } = load('lib/people-import.ts')
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

test('spreadsheet input preserves IDs, commas and empty optional columns', () => {
  const rows = parseTable('\uFEFFexternal_id\tfirst_name\tlast_name\tpreferred_name\r\n0001\tSam, Example\t\t\r\n0002\tJo\tExample\tJo', '\t')
  assert.equal(rows[1][0], '0001')
  assert.equal(rows[1][1], 'Sam, Example')
  const map = {external_id:0,first_name:1,last_name:2,preferred_name:3}
  assert.ok(validateImportRows(rows,'clients',map).every(row=>!row.error))
  for(const source of ['', 'id\tname', 'id\t\n1\tSam', 'First Name\tfirst_name\nSam\tJo']) assert.throws(()=>parseTable(source,'\t'))
  assert.throws(()=>validateImportRows([], 'clients', map), /at least one/)
  for(const invalid of [1.5, -2, 99]) assert.throws(()=>validateImportRows(rows,'clients',{...map,last_name:invalid}), /available column/)
})

test('canonical transport validation matches mapped files and rejects foreign fields', () => {
  const rows = [{external_id:'C1',first_name:'Sam',last_name:'Example',preferred_name:''}]
  assert.deepEqual(validatePeopleRows(rows,'clients',[],2),validateImportRows(parseCsv('external_id,first_name,last_name,preferred_name\nC1,Sam,Example,'),'clients',{external_id:0,first_name:1,last_name:2,preferred_name:3}))
  assert.match(validatePeopleRows([{...rows[0],organization_id:'other'}],'clients')[0].error,/supported fields/)
  assert.match(validatePeopleRows([{external_id:1,first_name:'Sam'}],'clients')[0].error,/text values/)
  assert.throws(()=>validatePeopleRows([],'clients'))
  assert.throws(()=>validatePeopleRows(Array.from({length:101},()=>rows[0]),'clients'),/100/)
  const corrected = validatePeopleRows([{external_id:'X',first_name:''},{external_id:'X',first_name:'Jo'},{external_id:'X',first_name:'Sam'}],'clients')
  assert.ok(corrected[0].error)
  assert.equal(corrected[1].error,null,'invalid rows do not suppress valid rows with the same ID')
  assert.match(corrected[2].error,/Duplicate/)
})

test('invitation responses distinguish acceptance, duplicate, limit, and uncertainty', () => {
  assert.deepEqual(invitationOutcome(200,{invited:true,user_id:'synthetic'}),{status:'Invitation request accepted — delivery unverified',done:true,pause:false})
  assert.equal(invitationOutcome(409,{code:'USER_ALREADY_IN_ORGANIZATION'}).done,true)
  assert.match(invitationOutcome(429,{error:'limit'}).status,/email limit/)
  assert.match(invitationOutcome(429,{retryAfter:3600}).status,/wait 60 minute/)
  assert.doesNotMatch(invitationOutcome(429,{retryAfter:'private'}).status,/private/)
  for(const [status,body] of [[200,{}],[200,null],[200,{invited:true}],[503,{error:'timeout'}],[500,{error:'profile incomplete'}],[409,{code:'EMAIL_ALREADY_IN_USE'}]]) {
    const outcome=invitationOutcome(status,body)
    assert.equal(outcome.done,false)
    assert.equal(outcome.pause,true)
    assert.match(outcome.status,/uncertain/)
  }
})

test('Brightwheel original headings and extra data map without editing the file', () => {
  const csv=parseCsv('Student ID,Last Name,Brightwheel ID,First Name,Parent Email,Rooms\ncustom-1,Example,00001,Sam,parent@example.invalid,North')
  const mapping=suggestImportMapping(csv[0],'clients','brightwheel')
  assert.equal(mapping.external_id,2)
  const row=validateImportRows(csv,'clients',mapping,{idPrefix:'brightwheel.site1'})[0]
  assert.equal(row.error,null)
  assert.deepEqual(row.values,{external_id:'brightwheel.site1:00001',first_name:'Sam',last_name:'Example',preferred_name:''})
  assert.throws(()=>validateImportRows(csv,'clients',mapping,{idPrefix:'bad:prefix'}),/namespace/)
})

test('all five source profiles accept reordered canonical columns but never infer guardian IDs', () => {
  for(const source of importSources.filter(source=>source.id!=='generic')) {
    const csv=parseCsv('last_name,external_id,first_name,Unrelated Field\nExample,0001,Sam,Ignored')
    assert.equal(validateImportRows(csv,'clients',suggestImportMapping(csv[0],'clients',source.id))[0].error,null,source.id)
    const ambiguous=suggestImportMapping(['Child ID','Student ID','First Name','Child First Name','Parent Email'],'clients',source.id)
    assert.equal(ambiguous.first_name,-1)
    assert.equal(suggestImportMapping(['Parent Email','Name','Role'],'staff',source.id).email,-1)
  }
  assert.equal(suggestImportMapping(['Child ID','Student ID','First Name'],'clients','playground').external_id,-1)
})

test('exported staff roles require explicit mapping and source activation never creates readiness', () => {
  const csv=parseCsv('Name,Email,Role,Account activation status\nAlex Example,alex@example.invalid,Lead Teacher,Activated\nAdmin Example,admin@example.invalid,Administrator,Activated')
  const mapping=suggestImportMapping(csv[0],'staff','brightwheel')
  assert.ok(validateImportRows(csv,'staff',mapping,{roleMapping:{}}).every(row=>row.error))
  const rows=validateImportRows(csv,'staff',mapping,{roleMapping:{'Lead Teacher':'teacher'}})
  assert.equal(rows[0].error,null)
  assert.ok(rows[1].error)
  assert.deepEqual(Object.keys(rows[0].values),['full_name','email','role'])
  const hostile=parseCsv('Name,Email,Role\nAlex,alex@example.invalid,__proto__')
  assert.ok(validateImportRows(hostile,'staff',suggestImportMapping(hostile[0],'staff','brightwheel'),{roleMapping:{}})[0].error)
})

test('inactive source rows do not suppress later active IDs and separate staff names can be combined', () => {
  const csv=parseCsv('Child ID,First Name,Status\n1,Inactive,inactive\n1,Active,Current\n2,Blank,')
  const rows=validateImportRows(csv,'clients',suggestImportMapping(csv[0],'clients','famly'),{statusColumn:2})
  assert.deepEqual(rows.map(row=>!!row.error),[true,false,true])
  const staff=parseCsv('First Name,Last Name,Email,Role\nAlex,Example,alex@example.invalid,Teacher')
  const mapping={full_name:-1,email:2,role:3}
  assert.equal(validateImportRows(staff,'staff',mapping,{staffNameColumns:[0,1],roleMapping:{Teacher:'teacher'}})[0].values.full_name,'Alex Example')
  assert.throws(()=>validateImportRows(staff,'staff',mapping,{staffNameColumns:[0,2]}),/distinct/)
})
test('vocabulary supports case and plural forms without recursive replacement or changing substrings', () => {
  const education = vocabularyPresets.find(preset=>preset.id==='education').terms
  assert.equal(translatePortalText('Clients: create a session with Team Members and targets.',education),'Students: create a lesson with Teachers and goals.')
  assert.equal(translatePortalText('Client session_id client_id Sessions',education),'Student session_id client_id Lessons')
  assert.equal(translatePortalText('Clients', {...defaultTerms,client_plural:'Session Clients'}),'Session Clients')
})
