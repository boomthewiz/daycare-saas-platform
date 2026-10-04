const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { loadCareDatabase, applyCareMigration } = require('./helpers/care-db.cjs')
test('Setup settings and account editors preserve direct-request authorization boundaries', {
  skip: !process.env.REJOYCE_BASELINE_SQL || !process.env.REJOYCE_PGLITE_MODULE,
}, async () => {
  const db = await loadCareDatabase()
  try {
    await applyCareMigration(db)
    for (const name of ['setup_settings', 'permission_delegation', 'administrator_protection', 'billing_permission_delegation']) {
      let sql = fs.readFileSync(path.join(__dirname, '../supabase/tests/' + name + '.sql'), 'utf8')
      // The schema-only snapshot excludes Auth's profile-creation trigger.
      if (name !== 'setup_settings') sql = sql.replace('  UPDATE public.users', "  INSERT INTO public.users(id,email,role,status) SELECT id,email,'staff','active' FROM auth.users ON CONFLICT(id) DO NOTHING;\n  UPDATE public.users")
      await db.exec(sql)
    }
  } finally { await db.close() }
})
