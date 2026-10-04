/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node test harness, consistent with tests/helpers. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { validateSessionTypeDuration: validate } = require('./helpers/load-ts.cjs')('lib/session-type-duration.ts')
const { loadCareDatabase, applyCareMigration } = require('./helpers/care-db.cjs')

test('duration accepts whole decimal minutes at both boundaries', () => {
  for (const value of ['1','60','1440','0060']) assert.equal(validate(value), null, value)
})
test('duration rejects empty, zero, negative, fractional, nondecimal and out-of-range drafts', () => {
  for (const value of ['', ' ', '0', '000', '-1', '-0.5', '1.5', '60.0', '1441', '9999999999999999999999999', '1e2', '0x10', '+60', ' 60 ', 'NaN', 'Infinity', '60 minutes', '1,440', '６０', '60\n']) {
    assert.ok(validate(value), JSON.stringify(value))
  }
  assert.match(validate(''), /Enter/)
  assert.match(validate('0'), /at least/)
  assert.match(validate('-1'), /at least/)
  assert.match(validate('1.5'), /whole/)
  assert.match(validate('1441'), /1,440/)
})
test('database rejects invalid INSERT, UPDATE and UPSERT without rounding and preserves legacy rows', {
  skip: !process.env.REJOYCE_BASELINE_SQL || !process.env.REJOYCE_PGLITE_MODULE,
}, async () => {
  const db = await loadCareDatabase()
  try {
    await applyCareMigration(db)
    const org='22222222-2222-4222-8222-222222222222'
    await db.exec(`INSERT INTO public.organizations(id,name) VALUES('${org}','Synthetic duration');
      INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes)
      VALUES('${org}','Legacy missing','missing',NULL),('${org}','Legacy long','long',2000),('${org}','Valid','valid',60);`)
    const dir=path.join(__dirname,'../supabase/migrations')
    const migration=fs.readdirSync(dir).find(name=>name.endsWith('_session_type_duration_validation.sql'))
    await db.exec(fs.readFileSync(path.join(dir,migration),'utf8'))
    assert.deepEqual((await db.query('SELECT default_duration_minutes FROM public.session_types ORDER BY code')).rows.map(row=>row.default_duration_minutes), ['2000',null,'60'])
    for (const value of [null, 0, -1, 0.5, 1.5, 60.4, 1440.1, 1441, 'NaN', 'Infinity', '-Infinity']) {
      for (const operation of ['insert','update','upsert']) {
        const sql=operation==='update'
          ? 'UPDATE public.session_types SET default_duration_minutes=$1 WHERE code=\'valid\''
          : `INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES('${org}','Synthetic', '${operation==='upsert'?'valid':'new'}', $1) ${operation==='upsert'?'ON CONFLICT(organization_id,code) DO UPDATE SET default_duration_minutes=EXCLUDED.default_duration_minutes':''}`
        await assert.rejects(db.query(sql,[value]), { code:'23514' }, operation+' '+value)
      }
    }
    for (const value of [1,1440]) {
      await db.query("UPDATE public.session_types SET default_duration_minutes=$1 WHERE code='valid'",[value])
      assert.equal((await db.query("SELECT default_duration_minutes::integer minutes FROM public.session_types WHERE code='valid'")).rows[0].minutes,value)
    }
    await assert.rejects(db.query("UPDATE public.session_types SET name='Still invalid' WHERE code='missing'"),{code:'23514'})
    await db.exec("UPDATE public.session_types SET default_duration_minutes=60 WHERE code IN ('missing','long')")
    await db.exec('ALTER TABLE public.session_types VALIDATE CONSTRAINT session_types_duration_supported_check')
    // The new storage/check must preserve existing RLS, device, delegation and subscription boundaries.
    for (const name of ['setup_settings','permission_delegation','administrator_protection','billing_permission_delegation']) {
      let sql=fs.readFileSync(path.join(__dirname,'../supabase/tests/'+name+'.sql'),'utf8')
      if(name!=='setup_settings') sql=sql.replace('  UPDATE public.users',"  INSERT INTO public.users(id,email,role,status) SELECT id,email,'staff','active' FROM auth.users ON CONFLICT(id) DO NOTHING;\n  UPDATE public.users")
      await db.exec(sql)
    }
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/tests/session_type_duration.sql'),'utf8'))
  } finally { await db.close() }
})
