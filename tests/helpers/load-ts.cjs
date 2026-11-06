/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic TypeScript module loader. */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

module.exports = function loadTs(file) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  const localRequire = name => name.startsWith('.') ? loadTs(path.relative(path.resolve(__dirname,'../..'),path.resolve(path.dirname(path.resolve(__dirname,'../..',file)),name+'.ts'))) : require(name)
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
