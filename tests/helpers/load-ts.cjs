const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

module.exports = function loadTs(file) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
  return mod.exports
}
