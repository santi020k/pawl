import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE, defaultPolicy, effectiveRules, loadPolicy, mergeLayers } from '../src/policy.ts'
import { project } from './helpers.ts'

describe('mergeLayers', () => {
  it('starts from the default standard', () => {
    const policy = defaultPolicy()

    expect(policy.engine).toBe('auto')
    expect(policy.strict).toBe(false)
    expect(policy.style).toEqual(DEFAULT_STYLE)
    expect(effectiveRules(policy).get('no-debugger')).toBe('error')
  })

  it('lets later layers win', () => {
    const policy = mergeLayers([
      { source: 'company', input: { rules: { 'no-console': 'error' }, style: { quotes: 'double' } } },
      { source: 'repo', input: { rules: { 'no-console': 'off' }, style: { semicolons: true } } }
    ])

    expect(policy.rules['no-console']).toBe('off')
    expect(policy.style).toMatchObject({ quotes: 'double', semicolons: true })
  })

  it('keeps strict on once a layer turns it on', () => {
    const policy = mergeLayers([
      { source: 'company', input: { strict: true } },
      { source: 'repo', input: { strict: false } }
    ])

    expect(policy.strict).toBe(true)
    expect(effectiveRules(policy).get('@typescript-eslint/no-explicit-any')).toBe('error')
  })

  it('refuses to loosen a locked rule and records the attempt', () => {
    const policy = mergeLayers([
      { source: 'company', input: { rules: { 'no-console': 'error' }, locked: ['no-console', 'no-debugger'] } },
      { source: 'repo', input: { rules: { 'no-console': 'warn', 'no-debugger': 'off' } } }
    ])

    expect(policy.rules['no-console']).toBe('error')
    expect(effectiveRules(policy).get('no-debugger')).toBe('error')
    expect(policy.lockViolations).toEqual([
      { rule: 'no-console', wanted: 'warn', kept: 'error', source: 'repo' },
      { rule: 'no-debugger', wanted: 'off', kept: 'error', source: 'repo' }
    ])
  })

  it('allows tightening a locked rule', () => {
    const policy = mergeLayers([
      { source: 'company', input: { rules: { 'no-alert': 'warn' }, locked: ['no-alert'] } },
      { source: 'repo', input: { rules: { 'no-alert': 'error' } } }
    ])

    expect(policy.rules['no-alert']).toBe('error')
    expect(policy.lockViolations).toEqual([])
  })

  it('leaves out rules for technology the project does not use', () => {
    const rules = effectiveRules(defaultPolicy(), { typescript: false, technologies: [] })

    expect(rules.has('react-hooks/rules-of-hooks')).toBe(false)
    expect(rules.has('@typescript-eslint/no-explicit-any')).toBe(false)
    expect(rules.has('no-debugger')).toBe(true)
  })
})

describe('loadPolicy', () => {
  it('returns the default standard without a config file', async () => {
    expect(await loadPolicy(project())).toEqual(defaultPolicy())
  })

  it('follows extends to files and packages, in order', async () => {
    const root = project({
      'pawl.config.mjs':
        "export default { extends: ['@acme/policy', './local.json'], rules: { 'no-console': 'off' }, ignore: ['generated/**'] }\n",
      'local.json': { rules: { 'no-alert': 'error' } },
      // An ESM-only package: resolvable with import but not with require.
      'node_modules/@acme/policy/package.json': {
        name: '@acme/policy',
        type: 'module',
        exports: { '.': { import: './index.js' } }
      },
      'node_modules/@acme/policy/index.js':
        "export default { strict: true, rules: { 'no-console': 'error' }, locked: ['no-debugger'] }\n"
    })
    const policy = await loadPolicy(root)

    expect(policy.strict).toBe(true)
    expect(policy.rules).toEqual({ 'no-console': 'off', 'no-alert': 'error' })
    expect(policy.locked).toEqual(['no-debugger'])
    expect(policy.ignore).toEqual(['generated/**'])
    expect(policy.sources).toEqual(['pawl defaults', '@acme/policy', './local.json', 'pawl.config.mjs'])
  })

  it('explains a missing policy package', async () => {
    const root = project({ 'pawl.config.json': { extends: '@acme/missing' } })

    await expect(loadPolicy(root)).rejects.toThrow(/Cannot find "@acme\/missing"/)
  })

  it('rejects a config without a default export', async () => {
    const root = project({ 'pawl.config.mjs': 'export const policy = {}\n' })

    await expect(loadPolicy(root)).rejects.toThrow(join(root, 'pawl.config.mjs'))
  })
})
