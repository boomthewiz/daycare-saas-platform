/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness matches tests/helpers/load-ts.cjs. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { features, reports, tutorials, authorizationReferences, getFeature, getFeatureInventory } = require('./helpers/load-ts.cjs')('lib/feature-registry.ts')

test('inventory references form a closed, acyclic graph with source-backed authorization', () => {
  for (const [items, key] of [[features, 'key'], [reports, 'id'], [tutorials, 'id']]) {
    assert.equal(new Set(items.map(item => item[key])).size, items.length)
    for (const item of items) {
      for (const ref of item.authorization) assert.ok(authorizationReferences[ref], `${item[key]}: ${ref}`)
      if (item.featureKey) assert.ok(getFeature(item.featureKey), item[key])
    }
  }
  for (const ref of Object.values(authorizationReferences)) assert.ok(fs.existsSync(path.resolve(__dirname, '..', ref.source)), ref.source)
  function visit(key, ancestors = []) {
    assert.ok(!ancestors.includes(key), `Dependency cycle: ${[...ancestors, key]}`)
    const feature = getFeature(key)
    assert.ok(feature, key)
    for (const dependency of feature.dependencies) visit(dependency, [...ancestors, key])
  }
  for (const feature of features) visit(feature.key)
  assert.equal(getFeature('toString'), undefined)
  assert.equal(getFeatureInventory('unregistered'), undefined)
})

test('all research bookmarks survive, with truthful initial report maturity and staff authority', () => {
  const research = new Set(reports.flatMap(report => report.researchIds))
  for (let id = 1; id <= 18; id++) assert.ok(research.has(`R${id}`), `Lost R${id}`)
  for (const id of ['D1', 'D2', 'D3']) assert.equal(reports.find(report => report.id === id).maturity, 'implemented')
  assert.ok(reports.find(report => report.id === 'D2').authorization.includes('users'))
  for (const id of ['D4', 'D5', 'D6', 'D7.care', 'D7.pickup']) assert.equal(reports.find(report => report.id === id).maturity, 'blocked')
  const roster = getFeatureInventory('people.roster')
  assert.equal(roster.maturity, 'implemented')
  assert.equal(roster.reports.find(report => report.id === 'D1').maturity, 'implemented')
})

test('base tutorial definitions have no clinical dependency or required clinical learning', () => {
  function baseOnly(key) {
    const feature = getFeature(key)
    assert.equal(feature.proposedBundle, 'base', key)
    assert.ok(!feature.domains.includes('aba') && !feature.domains.includes('care_services'), key)
    feature.dependencies.forEach(baseOnly)
  }
  for (const tutorial of tutorials.filter(tutorial => tutorial.id.startsWith('base.'))) baseOnly(tutorial.featureKey)
  assert.ok(tutorials.every(tutorial => tutorial.requiredForBaseReadiness === false))
  assert.ok(features.every(feature => feature.authorization.includes('baseline') && feature.authorization.includes('subscription')))
  assert.equal(getFeature('security.baseline').proposedBundle, 'base')
  // Inventory deliberately offers no enabled/entitled/compliant decision to runtime callers.
  for (const item of [...features, ...reports, ...tutorials]) {
    for (const field of ['enabled', 'entitled', 'compliant']) assert.equal(Object.hasOwn(item, field), false)
  }
})
