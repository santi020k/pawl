import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check.ts'
import { biomeConfig, biomeTechConfig } from '../src/engines/biome.ts'
import { applyInit, formatWritten, planInit } from '../src/init.ts'
import { defaultPolicy } from '../src/policy.ts'
import { link, project, write } from './helpers.ts'

const ready = async (files: Record<string, string | object>): Promise<string> => {
  const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' }, ...files })

  link(root)

  const plan = await planInit({ root, install: false, editor: false })

  applyInit(plan)
  await formatWritten(
    root,
    plan.actions.map(action => action.path)
  )

  return root
}

describe('what Biome checks beyond scripts', () => {
  it('sorts package.json the way the ecosystem expects, and no other JSON file', () => {
    expect(biomeConfig(defaultPolicy()).assist).toEqual({
      actions: { source: { organizeImports: 'on', useSortedPackageJson: 'on' } }
    })
  })

  it('parses the Tailwind at-rules in CSS for projects that use Tailwind', () => {
    expect(biomeTechConfig(defaultPolicy(), 'tailwind')).toMatchObject({
      css: { parser: { tailwindDirectives: true } }
    })
    expect(biomeTechConfig(defaultPolicy(), 'react')).not.toHaveProperty('css')
  })
})

describe('what Biome checks beyond scripts, with the real Biome', { timeout: 60_000 }, () => {
  it('lints and formats CSS and GraphQL', async () => {
    const root = await ready({ 'src/a.css': 'a { color: red;; }\n', 'src/q.graphql': 'query { user { id } }\n' })
    const found = (await check({ root })).findings.map(finding => `${finding.file} ${finding.rule}`)

    expect(found).toEqual(expect.arrayContaining(['src/a.css pawl/format', 'src/q.graphql pawl/format']))
    expect(found.some(line => line.startsWith('src/q.graphql biome:'))).toBe(true)
  })

  it('reports package.json fields out of order, and "fix" puts them in order', async () => {
    const root = await ready({})

    write(root, { 'package.json': { version: '1.0.0', type: 'module', name: 'fixture', private: true } })

    expect((await check({ root })).findings).toContainEqual(
      expect.objectContaining({ file: 'package.json', rule: 'pawl/sort-package-json', fixable: true })
    )

    await check({ root, fix: true })

    expect(Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')))).toEqual([
      'name',
      'version',
      'private',
      'type'
    ])
  })
})
