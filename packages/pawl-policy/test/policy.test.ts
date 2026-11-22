import { defaultPolicy, effectiveRules, getRule, mergeLayers, resolvePolicy } from '@santi020k/pawl'
import { describe, expect, it } from 'vitest'

import policy from '../index.js'

const file = new URL('../index.js', import.meta.url).pathname

describe('@santi020k/pawl-policy', () => {
  it('names only rules from the catalog, so every engine reads them the same way', () => {
    const names = [...Object.keys(policy.rules ?? {}), ...(policy.locked ?? [])]

    expect(names.filter(name => !getRule(name))).toEqual([])
  })

  it('locks only rules that are stable in Biome', () => {
    const unstable = (policy.locked ?? []).filter(name => getRule(name)?.nursery)

    expect(unstable).toEqual([])
  })

  it('only tightens the default standard', async () => {
    const order = { off: 0, warn: 1, error: 2 } as const
    const strict = await resolvePolicy(policy, file)
    const base = effectiveRules(defaultPolicy(), { typescript: true })
    const tightened = effectiveRules(strict, { typescript: true })
    const looser = [...base].filter(([name, level]) => order[tightened.get(name) ?? 'off'] < order[level])

    expect(strict.strict).toBe(true)
    expect(looser).toEqual([])
  })

  it('errors on the locked rules', async () => {
    const rules = effectiveRules(await resolvePolicy(policy, file), { typescript: true })

    for (const name of policy.locked ?? []) expect(rules.get(name)).toBe('error')
  })

  it('keeps a locked rule when a repo tries to loosen it, and reports the attempt', () => {
    const merged = mergeLayers([
      { input: policy, source: '@santi020k/pawl-policy' },
      {
        input: { rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' } },
        source: 'pawl.config.ts'
      }
    ])

    const rules = effectiveRules(merged, { typescript: true })

    expect(rules.get('@typescript-eslint/no-explicit-any')).toBe('error')
    expect(rules.get('no-console')).toBe('off')
    expect(merged.lockViolations).toEqual([
      { rule: '@typescript-eslint/no-explicit-any', wanted: 'off', kept: 'error', source: 'pawl.config.ts' }
    ])
  })

  it('fails on any new warning, and a repo cannot raise that limit', () => {
    const merged = mergeLayers([
      { input: policy, source: '@santi020k/pawl-policy' },
      { input: { maxWarnings: 20 }, source: 'pawl.config.ts' }
    ])

    expect(merged.maxWarnings).toBe(0)
  })

  it('lets scripts and command-line entry points use the console, and nothing else', async () => {
    const { overrides } = await resolvePolicy(policy, file)

    expect(overrides).toMatchObject([
      { files: ['scripts/**', '**/scripts/**', '**/bin/**'], rules: { 'no-console': 'off' } }
    ])
    expect(overrides).toHaveLength(1)
  })

  it('leaves the choice between a declaration and an arrow function to the author', async () => {
    const rules = effectiveRules(await resolvePolicy(policy, file), { typescript: true })

    expect(rules.get('func-style')).toBe('off')
  })

  it('cannot have strict turned off by a repo', () => {
    const merged = mergeLayers([
      { input: policy, source: '@santi020k/pawl-policy' },
      { input: { strict: false }, source: 'pawl.config.ts' }
    ])

    expect(merged.strict).toBe(true)
  })
})
