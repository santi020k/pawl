import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check.ts'
import { biomeConfig, biomeProjectConfig } from '../src/engines/biome.ts'
import { eslintPlan } from '../src/engines/eslint.ts'
import { oxlintConfig } from '../src/engines/oxlint.ts'
import { applyInit, planInit } from '../src/init.ts'
import { mergeLayers } from '../src/policy.ts'
import { type PolicyInput } from '../src/types.ts'
import { link, PACKAGE_ROOT, project } from './helpers.ts'

const TESTS = { files: ['*.test.js', '*.test.ts'], rules: { 'no-debugger': 'off' as const } }

const policyWith = (input: PolicyInput) => mergeLayers([{ source: 'repo', input }])

describe('overrides in the policy', () => {
  it('add up across layers, with rule names made canonical', () => {
    const policy = mergeLayers([
      { source: 'company', input: { overrides: [{ files: ['scripts/**'], rules: { 'no-console': 'off' } }] } },
      {
        source: 'repo',
        input: {
          overrides: [
            {
              files: ['*.test.ts'],
              rules: { '@typescript-eslint/no-unused-vars': 'off' },
              options: { 'no-console': [{ allow: ['warn'] }] }
            }
          ]
        }
      }
    ])

    expect(policy.overrides).toEqual([
      { files: ['scripts/**'], rules: { 'no-console': 'off' }, options: {} },
      { files: ['*.test.ts'], rules: { 'no-unused-vars': 'off' }, options: { 'no-console': [{ allow: ['warn'] }] } }
    ])
  })

  it('cannot loosen a locked rule for some files either', () => {
    const policy = mergeLayers([
      { source: 'company', input: { locked: ['no-debugger'] } },
      { source: 'repo', input: { overrides: [TESTS] } }
    ])

    expect(policy.overrides[0]?.rules['no-debugger']).toBe('error')
    expect(policy.lockViolations).toEqual([
      { rule: 'no-debugger', wanted: 'off', kept: 'error', source: 'repo (overrides)' }
    ])
  })

  it('become Biome overrides, with the file patterns anchored the way Biome reads them', () => {
    const policy = policyWith({
      overrides: [TESTS, { files: ['docs/**'], rules: { 'react/no-danger': 'off' } }]
    })

    // The second override is for React, which this project does not use, so Biome gets none for it.
    expect(biomeConfig(policy).overrides).toEqual([
      { includes: ['**/*.test.js', '**/*.test.ts'], linter: { rules: { suspicious: { noDebugger: 'off' } } } }
    ])
    expect(biomeProjectConfig(policy).overrides).toEqual(biomeConfig(policy).overrides)
  })

  it('become Oxlint overrides, with the plugins they need and their options', () => {
    const policy = policyWith({
      overrides: [
        TESTS,
        { files: ['src/**'], rules: { 'no-console': 'error' }, options: { 'no-console': [{ allow: ['warn'] }] } }
      ]
    })

    expect(oxlintConfig(policy).overrides).toEqual([
      { files: ['**/*.test.js', '**/*.test.ts'], rules: { 'no-debugger': 'off' } },
      { files: ['src/**'], rules: { 'no-console': ['error', { allow: ['warn'] }] } }
    ])
    // Options alone keep the level the rule has.
    expect(
      oxlintConfig(
        policyWith({ overrides: [{ files: ['scripts/**'], options: { 'no-console': [{ allow: ['log'] }] } }] })
      ).overrides
    ).toEqual([{ files: ['scripts/**'], rules: { 'no-console': ['warn', { allow: ['log'] }] } }])
  })

  it('become ESLint entries after the base and the packs, leaving to Biome what Biome enforces', async () => {
    const root = project({ 'package.json': { name: 'fixture' } })
    const policy = policyWith({
      overrides: [{ files: ['*.test.js'], rules: { 'no-debugger': 'off', 'no-restricted-globals': 'error' } }]
    })
    const withBiome = await eslintPlan({ root, policy, biomeActive: true, typescript: false })
    const alone = await eslintPlan({ root, policy, biomeActive: false, typescript: false })

    expect(withBiome.config.at(-1)).toEqual({
      name: 'pawl/override/0',
      files: ['**/*.test.js'],
      rules: { 'no-restricted-globals': 'error' }
    })
    expect(alone.config.at(-1)).toMatchObject({ rules: { 'no-debugger': 'off', 'no-restricted-globals': 'error' } })
  })

  it('turn the typescript-eslint twin of a core rule in TypeScript files too', async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      'node_modules/typescript-eslint/package.json': {
        name: 'typescript-eslint',
        type: 'module',
        exports: './index.js'
      },
      'node_modules/typescript-eslint/index.js': 'export default { parser: {}, plugin: { rules: {} } }\n'
    })
    const policy = policyWith({ overrides: [{ files: ['*.test.ts'], rules: { 'no-unused-vars': 'off' } }] })
    const plan = await eslintPlan({ root, policy, biomeActive: false, typescript: true })

    expect(plan.config.slice(-2)).toEqual([
      { name: 'pawl/override/0', files: ['**/*.test.ts'], rules: { 'no-unused-vars': 'off' } },
      {
        name: 'pawl/override/0/typescript',
        files: [['**/*.test.ts', '**/*.{ts,mts,cts,tsx}']],
        plugins: { '@typescript-eslint': expect.any(Object) },
        rules: { 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': 'off' }
      }
    ])
  })

  it('give options alone to a rule at the level it has, and say when a plugin is missing', async () => {
    const root = project({ 'package.json': { name: 'fixture' } })
    const policy = policyWith({
      overrides: [
        { files: ['scripts/**'], options: { 'no-console': [{ allow: ['log'] }] } },
        { files: ['src/**'], rules: { 'unicorn/no-null': 'error' } }
      ]
    })
    const plan = await eslintPlan({ root, policy, biomeActive: false, typescript: false })

    expect(plan.config.find(entry => entry.name === 'pawl/override/0')).toMatchObject({
      rules: { 'no-console': ['warn', { allow: ['log'] }] }
    })
    expect(plan.notEnforced).toContainEqual({ rule: 'unicorn/no-null', needs: 'eslint-plugin-unicorn' })
  })
})

describe('overrides, with the real engines', { timeout: 60_000 }, () => {
  const files = {
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'src/a.js': 'debugger\n',
    'src/a.test.js': 'debugger\n'
  }
  const flagged = (result: Awaited<ReturnType<typeof check>>): string[] =>
    result.findings.filter(finding => finding.rule === 'no-debugger').map(finding => finding.file)

  it('apply in Biome', async () => {
    const root = project({ ...files, 'pawl.config.json': { overrides: [TESTS] } })

    link(root)
    applyInit(await planInit({ root, install: false, editor: false }))

    expect(flagged(await check({ root }))).toEqual(['src/a.js'])
  })

  it('apply in Oxlint', async () => {
    const root = project({ ...files, 'pawl.config.json': { engine: 'oxlint', overrides: [TESTS] } })

    link(root)
    applyInit(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    const result = await check({ root })

    expect(result.setup).toEqual([])
    expect(flagged(result)).toEqual(['src/a.js'])
  })

  it.runIf(existsSync(join(PACKAGE_ROOT, 'dist/index.js')))('apply in ESLint', async () => {
    const root = project({
      ...files,
      'pawl.config.json': { engine: 'eslint', formatter: 'prettier', overrides: [TESTS] },
      '.prettierrc.json': '{}\n',
      'eslint.config.js':
        "import { eslint } from '@santi020k/pawl'\n\nexport default eslint({ root: import.meta.dirname })\n"
    })

    link(root, { eslint: true, prettier: true })

    const result = await check({ root })

    expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
    expect(flagged(result)).toEqual(['src/a.js'])
  })
})
