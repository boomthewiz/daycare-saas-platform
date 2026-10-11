/* eslint-disable @typescript-eslint/no-require-imports -- Node synthetic test harness. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
process.env.TZ = 'America/Chicago'
const { addDays, localDate, localDateTime, parseLocalDate, parseCalendarDraft, placeEvents, weekStart } = require('./helpers/load-ts.cjs')('lib/calendar.ts')

test('local calendar dates survive DST and reject invalid URL drafts', () => {
  assert.equal(parseLocalDate('2026-02-30'), null)
  assert.equal(parseCalendarDraft('2026-10-12T09:30'), '2026-10-12T09:30')
  for (const value of ['2026-02-30T09:00', '2026-10-12T25:00', '2026-03-08T02:30', '2026-10-12T09:00Z', '', null]) assert.equal(parseCalendarDraft(value), '')
  const before = new Date(2026, 2, 7)
  const after = addDays(before, 2)
  assert.equal(localDate(after), '2026-03-09')
  assert.equal(localDate(weekStart(after)), '2026-03-08')
  assert.equal(localDateTime(new Date(2026, 9, 12, 9, 30)), '2026-10-12T09:30')
})

test('overlapping sessions share columns without hiding adjacent sessions', () => {
  const session = (id, start, end) => ({ id, scheduled_start: `2026-10-12T${start}:00-05:00`, scheduled_end: `2026-10-12T${end}:00-05:00` })
  const placed = placeEvents([session('a','09:00','10:00'), session('b','09:30','11:00'), session('c','10:00','10:30'), session('d','11:00','12:00')], new Date(2026,9,12))
  assert.deepEqual(placed.map(item => [item.event.id, item.column, item.columns]), [['a',0,2],['b',1,2],['c',0,2],['d',0,1]])
})

test('overnight and missing-end sessions clip to day; boundary end does not duplicate', () => {
  const overnight = { id: 'overnight', scheduled_start: '2026-10-11T23:30:00-05:00', scheduled_end: '2026-10-12T00:30:00-05:00' }
  const missing = { id: 'missing', scheduled_start: '2026-10-12T09:00:00-05:00', scheduled_end: null }
  const boundary = { id: 'boundary', scheduled_start: '2026-10-11T23:00:00-05:00', scheduled_end: '2026-10-12T00:00:00-05:00' }
  const invalid = { id: 'invalid', scheduled_start: 'bad', scheduled_end: null }
  assert.deepEqual(placeEvents([overnight, missing, boundary, invalid],new Date(2026,9,12)).map(item=>[item.event.id,item.start,item.end]), [['overnight',0,30],['missing',540,570]])
})

test('calendar data paginates all records and constrains sessions through client branches', async () => {
  const queries = []
  let failure = false
  const rows = Array.from({length:1003}, (_,id)=>({id:String(id)}))
  const mock = { from: table => {
    const query = {table}; queries.push(query)
    const builder = {}
    for (const method of ['select','lt','or','eq']) builder[method] = (...args)=>{query[method]=args;return builder}
    builder.order = (...args)=>{(query.order ||= []).push(args);return builder}
    builder.range = async (start,end)=>{query.range=[start,end];return failure?{error:{message:'interrupted'},data:null}:{error:null,data:rows.slice(start,end+1)}}
    return builder
  }}
  const source = fs.readFileSync(require('node:path').join(__dirname,'../lib/calendar-data.ts'),'utf8')
  const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const mod = {exports:{}}
  new Function('require','module','exports',output)(name=>name==='@/lib/supabase'?{supabase:mock}:require(name),mod,mod.exports)
  const {readCalendarSessions}=mod.exports
  const start=new Date('2026-10-12T05:00:00Z'),end=new Date('2026-10-13T05:00:00Z')
  const result=await readCalendarSessions(start,end,'north')
  assert.equal(result.length,1003)
  assert.deepEqual(queries.map(query=>query.range),[[0,499],[500,999],[1000,1499]])
  assert.ok(queries.every(query=>query.select[0].includes('clients!inner')&&query.select[0].includes('client_locations!inner')))
  assert.deepEqual(queries[0].eq,['clients.client_locations.location_id','north'])
  assert.deepEqual(queries[0].lt,['scheduled_start',end.toISOString()])
  assert.ok(queries[0].or[0].includes('scheduled_end.gt.'+start.toISOString()))
  assert.deepEqual(queries[0].order,[['scheduled_start'],['id']])
  failure=true
  await assert.rejects(readCalendarSessions(start,end,''),/interrupted/)
})
