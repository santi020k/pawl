import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { catalogVersion, GROUPS, higher, newestSettled, setCatalogEntry } from './canary.ts'

const now = Date.parse('2026-11-24T12:00:00Z')

describe('the version the canary moves to', () => {
  it('is the highest stable version that is at least a day old', () => {
    const time = {
      created: '2020-01-01T00:00:00Z',
      modified: '2026-11-24T11:00:00Z',
      '2.6.8': '2026-11-01T00:00:00Z',
      '2.7.0': '2026-11-20T00:00:00Z',
      '2.7.1': '2026-11-24T06:00:00Z',
      '2.8.0-beta.1': '2026-11-10T00:00:00Z',
      '2.6.9': '2026-11-21T00:00:00Z'
    }

    assert.equal(newestSettled(time, now), '2.7.0')
    assert.equal(newestSettled({ '1.0.0': '2026-11-24T11:00:00Z' }, now), undefined)
  })
})

describe('a catalog entry', () => {
  const yaml = 'catalog:\n  "@biomejs/biome": 2.6.8\n  eslint: ^10.15.0\n  oxlint: 1.94.0\n'

  it('keeps its range operator', () => {
    assert.equal(
      setCatalogEntry(yaml, 'eslint', '10.20.1'),
      'catalog:\n  "@biomejs/biome": 2.6.8\n  eslint: ^10.20.1\n  oxlint: 1.94.0\n'
    )
    assert.equal(setCatalogEntry(yaml, '@biomejs/biome', '2.7.0')?.includes('"@biomejs/biome": 2.7.0'), true)
    assert.equal(setCatalogEntry(yaml, 'prettier', '3.0.0'), undefined)
  })

  it('is read without its operator, and never moves back', () => {
    assert.equal(catalogVersion(yaml, 'eslint'), '10.15.0')
    assert.equal(catalogVersion(yaml, '@biomejs/biome'), '2.6.8')
    assert.equal(higher('8.73.0', '8.74.0'), '8.74.0')
    assert.equal(higher('10.20.0', '10.15.0'), '10.20.0')
  })

  it('exists for every package a group moves', () => {
    const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')

    for (const [name, group] of Object.entries(GROUPS))
      for (const pkg of group.catalog)
        assert.notEqual(setCatalogEntry(workspace, pkg, '0.0.0'), undefined, `${name}: ${pkg}`)
  })

  it('names fixtures and pins that exist', () => {
    const fixtures = JSON.parse(
      readFileSync(new URL('../packages/pawl/test/fixtures/eslint/package.json', import.meta.url), 'utf8')
    ) as { devDependencies: Record<string, string> }

    for (const group of Object.values(GROUPS)) {
      for (const pkg of group.fixtures ?? []) assert.ok(fixtures.devDependencies[pkg], pkg)

      for (const pin of group.exact ?? [])
        assert.match(readFileSync(new URL(`../${pin.file}`, import.meta.url), 'utf8'), pin.pattern, pin.file)
    }
  })
})
