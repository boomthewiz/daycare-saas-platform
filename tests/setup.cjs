// Repository-owned, schema-only synthetic baseline. Never point tests at production.
const fs=require('node:fs'),path=require('node:path')
process.env.REJOYCE_BASELINE_SQL ||= path.join(__dirname,'fixtures/baseline.sql')
if(!fs.existsSync(process.env.REJOYCE_BASELINE_SQL))throw new Error('Required synthetic baseline missing: restore tests/fixtures/baseline.sql')
try{process.env.REJOYCE_PGLITE_MODULE ||= require.resolve('@electric-sql/pglite');require(process.env.REJOYCE_PGLITE_MODULE)}catch{throw new Error('Required PGlite dependency missing. Run npm ci (or explicitly configure REJOYCE_PGLITE_MODULE for a local runtime).')}
if(!process.env.REJOYCE_POSTGRES_CLIENT){try{process.env.REJOYCE_POSTGRES_CLIENT=require.resolve('postgres')}catch{/* Native test fails explicitly when required. */}}
