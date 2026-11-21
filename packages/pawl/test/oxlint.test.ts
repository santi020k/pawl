import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRule } from '../src/catalog/rules.ts'
import { check } from '../src/check/check.ts'
import { BIOME_PRESET } from '../src/engines/biome/config.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { checkOxlintConfig, oxlintConfig, oxlintCovers } from '../src/engines/oxlint/config.ts'
import { OXLINT_RULES, OXLINT_VERSION } from '../src/engines/oxlint/rules.ts'
import { runOxlint } from '../src/engines/oxlint/run.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import { toolset } from '../src/project/toolset.ts'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, project, write } from './helpers.ts'

const require = createRequire(import.meta.url)

describe('Oxlint rule list', () => {
  it('was generated from the Oxlint that is installed (run "pnpm run oxlint-rules" if this fails)', () => {
    expect((require('oxlint/package.json') as { version: string }).version).toBe(OXLINT_VERSION)
  })

  it('only names rules of the standard', () => {
    expect(Object.keys(OXLINT_RULES).filter(name => getRule(name)?.name !== name)).toEqual([])
    expect(oxlintCovers('no-debugger')).toBe(true)
    expect(oxlintCovers('pawl/format')).toBe(false)
  })
})

describe('oxlintConfig', () => {
  it('writes the rules Oxlint enforces under its own names, with the plugins they need', () => {
    const config = oxlintConfig(defaultPolicy(), { typescript: true, technologies: ['react'] }) as {
      plugins: string[]
      rules: Record<string, unknown>
    }

    expect(config.rules).toMatchObject({
      'no-debugger': 'error',
      'typescript/no-explicit-any': 'warn',
      'react/rules-of-hooks': 'error',
      'no-unused-vars': ['error', expect.objectContaining({ argsIgnorePattern: '^_' })]
    })
    expect(config.plugins).toEqual([...config.plugins].sort())
    expect(config.plugins).toEqual(expect.arrayContaining(['typescript', 'react', 'unicorn']))
  })

  it('leaves out technologies the project does not use, and follows the policy', () => {
    const policy = mergeLayers([
      { source: 'repo', input: { rules: { 'no-debugger': 'off' }, ignore: ['generated/**'] } }
    ])
    const config = oxlintConfig(policy, { typescript: true, technologies: [] }) as {
      rules: Record<string, unknown>
      ignorePatterns: string[]
    }

    expect(config.rules['no-debugger']).toBe('off')
    expect(config.rules['react/rules-of-hooks']).toBeUndefined()
    expect(config.ignorePatterns).toContain('generated/**')
  })

  it('enforces the jsx-a11y standard in React projects and the promise rules everywhere, natively', () => {
    const react = oxlintConfig(defaultPolicy(), { technologies: ['react'] }) as {
      plugins: string[]
      rules: Record<string, unknown>
    }
    const plain = oxlintConfig(defaultPolicy(), { technologies: [] }) as typeof react

    expect(react.plugins).toEqual(expect.arrayContaining(['jsx-a11y', 'promise']))
    expect(react.rules).toMatchObject({
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/no-static-element-interactions': ['error', expect.objectContaining({ allowExpressionValues: true })],
      'promise/catch-or-return': 'warn'
    })
    expect(plain.plugins).not.toContain('jsx-a11y')
    expect(plain.rules['promise/always-return']).toBe('warn')
  })
})

describe('Oxlint as the linter, with the real Oxlint', { timeout: 60_000 }, () => {
  it('sets up, lints by neutral rule names, and reports drift', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/a.js': 'var count = 1\ndebugger\nif (count == 2) {\n}\nexport { count }\n'
    })

    link(root)

    const plan = await planInit({ root, engine: 'oxlint', install: false, editor: false })

    expect(plan.engines).toEqual(['oxlint'])
    expect(plan.formatter).toBe('biome')
    expect(plan.packages).toEqual(['@santi020k/pawl', '@biomejs/biome', 'oxlint'])
    expect(plan.actions.map(action => action.path)).toEqual([
      'pawl.config.ts',
      'biome.json',
      '.oxlintrc.json',
      'package.json'
    ])
    applyPlan(plan)
    expect(readFileSync(join(root, 'pawl.config.ts'), 'utf8')).toContain("engine: 'oxlint'")
    // Biome is only there to format.
    expect(JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8'))).toEqual({
      extends: [BIOME_PRESET],
      linter: { enabled: false }
    })
    expect(toolset(root, plan.policy)).toEqual({ linter: 'oxlint', formatter: 'biome', biome: true, eslint: false })

    const result = await check({ root, policy: plan.policy, files: ['src/a.js'] })
    const fromOxlint = result.findings.filter(finding => finding.engine === 'oxlint')

    expect(result.setup).toEqual([])
    expect(result.commands).toEqual(['biome check src/a.js', 'oxlint src/a.js'])
    expect(fromOxlint.map(finding => `${finding.line} ${finding.rule}`)).toEqual([
      '1 no-var',
      '2 no-debugger',
      '3 eqeqeq',
      '3 no-empty'
    ])
    expect(fromOxlint[0]).toMatchObject({ file: 'src/a.js', engineRule: 'no-var', severity: 'error' })

    // A policy change is reported until the config is synced.
    const changed = mergeLayers([{ source: 'repo', input: { engine: 'oxlint', rules: { 'no-var': 'off' } } }])

    expect(checkOxlintConfig(root, changed, { typescript: true, technologies: [] }).status).toBe('stale')
    write(root, { '.oxlintrc.json': oxlintConfig(changed, { typescript: true, technologies: [] }) })

    const after = await check({ root, policy: changed, files: ['src/a.js'] })

    expect(after.findings.filter(finding => finding.engine === 'oxlint').map(finding => finding.rule)).toEqual([
      'no-debugger',
      'eqeqeq',
      'no-empty'
    ])
  })

  it('reports the accessibility and promise rules from the real Oxlint, without their ESLint plugins', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/a.jsx':
        'export const A = () => <img src="a.png" />\nexport const load = () => { fetch(\'a\').then(r => { r.json() }) }\n'
    })

    link(root)
    write(root, { '.oxlintrc.json': oxlintConfig(defaultPolicy(), { technologies: ['react'] }) })

    const result = await runOxlint({ root, files: ['src/a.jsx'] })

    expect(result.findings.map(finding => finding.rule)).toEqual(
      expect.arrayContaining(['jsx-a11y/alt-text', 'promise/always-return', 'promise/catch-or-return'])
    )
  })

  it('leaves to Oxlint what it enforces when ESLint runs next to it for the packs', async () => {
    const plan = await eslintPlan({
      root: project({ 'package.json': { name: 'fixture' } }),
      policy: defaultPolicy(),
      biomeActive: false,
      oxlintActive: true,
      typescript: false
    })
    const base = plan.config.find(entry => entry.name === 'pawl/base')?.rules as Record<string, unknown>

    expect(plan.coveredByBiome).toContain('no-debugger')
    expect(base['no-debugger']).toBeUndefined()
    // ESLint is not the linter here, so its own base pack stays off.
    expect(plan.activePacks).toEqual([])
    // A rule of the standard that Oxlint does not have falls to ESLint.
    expect(Object.keys(base).every(name => !oxlintCovers(name))).toBe(true)
  })
})
