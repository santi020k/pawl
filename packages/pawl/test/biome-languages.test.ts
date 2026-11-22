import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { biomeConfig, biomeTechConfig } from '../src/engines/biome/config.ts'
import { defaultPolicy } from '../src/policy/merge.ts'
import { formatWritten, planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, project, write } from './helpers.ts'

const ready = async (files: Record<string, string | object>): Promise<string> => {
  const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' }, ...files })

  link(root)

  const plan = await planInit({ root, install: false, editor: false })

  applyPlan(plan)
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

describe('component files, with the real Biome', { timeout: 60_000 }, () => {
  // Biome reads the script of a component and not its template, where Status and Child are used.
  const VUE = `<script setup lang="ts">
import Child from './Child.vue'
import { Status } from './types'

defineProps<{ status: Status }>()
</script>

<template>
  <Child v-if="status === Status.Active" />
</template>
`
  const ASTRO = `---
import Card from '../Card.astro'
import { Status } from '../types'

const status: Status = Astro.props.status
---
<Card>{status === Status.Active ? 'on' : 'off'}</Card>
`
  const files = {
    'package.json': {
      name: 'fixture',
      private: true,
      type: 'module',
      dependencies: { vue: '^3.5.0', astro: '^5.0.0' },
      devDependencies: { typescript: '^5.9.0' }
    },
    'src/Card.vue': VUE,
    'src/pages/index.astro': ASTRO,
    'src/types.ts': "export enum Status {\n  Active = 'active'\n}\n"
  }
  const unused = (result: Awaited<ReturnType<typeof check>>): string[] =>
    result.findings
      .filter(finding => /unused|consistent-type-imports|prefer-const/.test(finding.rule))
      .map(finding => `${finding.file} ${finding.rule}`)

  it('keep the imports their templates use, and are not told those are unused', async () => {
    const root = await ready(files)

    expect(unused(await check({ root }))).toEqual([])

    // The fix for a type-only import is a safe one, so "pawl fix" applied it and broke the template.
    await check({ root, fix: true })

    expect(readFileSync(join(root, 'src/Card.vue'), 'utf8')).toBe(VUE)
    expect(readFileSync(join(root, 'src/pages/index.astro'), 'utf8')).toBe(ASTRO)
  })

  it('still get those rules in a plain script, and in a component when the policy says so', async () => {
    const root = await ready({ ...files, 'src/a.ts': "import { Status } from './types'\n\nexport const b = 1\n" })

    expect(unused(await check({ root }))).toEqual(['src/a.ts unused-imports/no-unused-imports'])

    // A policy that has switched on Biome's full support for these files can have the rule back.
    write(root, {
      'pawl.config.json': { overrides: [{ files: ['*.vue'], rules: { 'unused-imports/no-unused-imports': 'error' } }] }
    })
    applyPlan(await planInit({ root, install: false, editor: false }))

    expect(unused(await check({ root }))).toEqual([
      'src/a.ts unused-imports/no-unused-imports',
      'src/Card.vue unused-imports/no-unused-imports'
    ])
  })
})
