import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { BIOME_PRESET, biomeConfig, biomeProjectConfig, biomeTechConfig } from '../src/engines/biome/config.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { oxlintConfig } from '../src/engines/oxlint/config.ts'
import { loadPolicy } from '../src/policy/load.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { type PolicyInput } from '../src/types.ts'
import { link, PACKAGE_ROOT, project } from './helpers.ts'

const policyWith = (...inputs: PolicyInput[]) =>
  mergeLayers(inputs.map((input, index) => ({ source: `layer ${index + 1}`, input })))

const COMPLEXITY = 'biome:complexity/noExcessiveCognitiveComplexity'

describe('Biome options in the policy', () => {
  it('replace the options of the standard, under any name of the rule', () => {
    const policy = policyWith({ biomeOptions: { '@typescript-eslint/no-unused-vars': { ignoreRestSiblings: false } } })

    expect(policy.biomeOptions).toEqual({ 'no-unused-vars': { ignoreRestSiblings: false } })
    expect(biomeProjectConfig(policy)).toEqual({
      extends: [BIOME_PRESET],
      linter: {
        rules: { correctness: { noUnusedVariables: { level: 'error', options: { ignoreRestSiblings: false } } } }
      }
    })
  })

  it('follow the level the policy sets, and are left out when the rule is off', () => {
    const options = { biomeOptions: { 'no-unused-vars': { ignoreRestSiblings: false } } }
    const rulesOf = (policy: ReturnType<typeof policyWith>) =>
      (biomeConfig(policy) as { linter: { rules: { correctness: Record<string, unknown> } } }).linter.rules.correctness

    expect(rulesOf(policyWith(options, { rules: { 'no-unused-vars': 'warn' } })).noUnusedVariables).toEqual({
      level: 'warn',
      options: { ignoreRestSiblings: false }
    })
    expect(rulesOf(policyWith(options, { rules: { 'no-unused-vars': 'off' } })).noUnusedVariables).toBe('off')
  })

  it('reach a rule only Biome has, which needs a level too', () => {
    const policy = policyWith({
      rules: { [COMPLEXITY]: 'warn' },
      biomeOptions: { [COMPLEXITY]: { maxAllowedComplexity: 10 } }
    })

    expect(biomeProjectConfig(policy)).toMatchObject({
      linter: {
        rules: {
          complexity: { noExcessiveCognitiveComplexity: { level: 'warn', options: { maxAllowedComplexity: 10 } } }
        }
      }
    })
    expect(() => policyWith({ biomeOptions: { [COMPLEXITY]: { maxAllowedComplexity: 10 } } })).toThrow(
      /gives Biome options to biome:complexity\/noExcessiveCognitiveComplexity but no level/
    )
  })

  it('are refused for a rule Biome does not enforce, and when they are not an object', () => {
    expect(() => policyWith({ biomeOptions: { 'promise/always-return': {} } })).toThrow(
      /layer 1 gives Biome options to "promise\/always-return", which Biome does not enforce/
    )
    expect(() => policyWith({ biomeOptions: { 'no-unused-vars': [{ ignoreRestSiblings: false }] as never } })).toThrow(
      /Biome options that are not an object/
    )
  })

  it('are replaced whole by a later layer', () => {
    const policy = policyWith(
      { biomeOptions: { 'no-unused-vars': { ignoreRestSiblings: false } } },
      { biomeOptions: { 'no-unused-vars': {} } }
    )

    expect(policy.biomeOptions).toEqual({ 'no-unused-vars': {} })
  })

  it('apply to some files only through an override, at the level the rule has', () => {
    const policy = policyWith({
      rules: { [COMPLEXITY]: 'error' },
      biomeOptions: { [COMPLEXITY]: { maxAllowedComplexity: 10 } },
      overrides: [
        { files: ['legacy/**'], biomeOptions: { [COMPLEXITY]: { maxAllowedComplexity: 40 } } },
        { files: ['*.test.ts'], rules: { [COMPLEXITY]: 'warn' } }
      ]
    })

    expect(biomeProjectConfig(policy).overrides).toEqual([
      {
        includes: ['legacy/**'],
        linter: {
          rules: {
            complexity: { noExcessiveCognitiveComplexity: { level: 'error', options: { maxAllowedComplexity: 40 } } }
          }
        }
      },
      {
        // An override that only changes the level keeps the policy's options.
        includes: ['**/*.test.ts'],
        linter: {
          rules: {
            complexity: { noExcessiveCognitiveComplexity: { level: 'warn', options: { maxAllowedComplexity: 10 } } }
          }
        }
      }
    ])
  })

  it('stay out of the shipped presets and of the other engines', async () => {
    const policy = policyWith({ biomeOptions: { 'react/jsx-key': { checkShorthandFragments: true } } })

    expect(biomeTechConfig(policy, 'react')).toEqual(biomeTechConfig(defaultPolicy(), 'react'))
    expect(JSON.stringify(oxlintConfig(policy))).not.toContain('checkShorthandFragments')

    const plan = await eslintPlan({ root: PACKAGE_ROOT, policy, biomeActive: false, typescript: false })

    expect(JSON.stringify(plan.config)).not.toContain('checkShorthandFragments')
  })

  it('are a key the policy file knows', async () => {
    const root = project({ 'pawl.config.json': { biomeOptions: { 'no-unused-vars': { ignoreRestSiblings: false } } } })

    expect((await loadPolicy(root)).biomeOptions).toEqual({ 'no-unused-vars': { ignoreRestSiblings: false } })
  })
})

describe('Biome options, with the real Biome', { timeout: 60_000 }, () => {
  const files = {
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'src/a.js': 'const { first, ...others } = globalThis.settings\n\nexport default others\n'
  }
  const unused = (result: Awaited<ReturnType<typeof check>>): string[] =>
    result.findings.filter(finding => finding.rule === 'no-unused-vars').map(finding => finding.file)

  it('change what a rule reports', async () => {
    const standard = project(files)
    const stricter = project({
      ...files,
      'pawl.config.json': { biomeOptions: { 'no-unused-vars': { ignoreRestSiblings: false } } }
    })

    for (const root of [standard, stricter]) {
      link(root)
      applyPlan(await planInit({ root, install: false, editor: false }))
    }

    expect(unused(await check({ root: standard }))).toEqual([])
    expect(unused(await check({ root: stricter }))).toEqual(['src/a.js'])
  })

  it('apply to some files only', async () => {
    const root = project({
      ...files,
      'src/legacy/b.js': files['src/a.js'],
      'pawl.config.json': {
        biomeOptions: { 'no-unused-vars': { ignoreRestSiblings: false } },
        overrides: [{ files: ['src/legacy/**'], biomeOptions: { 'no-unused-vars': { ignoreRestSiblings: true } } }]
      }
    })

    link(root)
    applyPlan(await planInit({ root, install: false, editor: false }))

    expect(unused(await check({ root }))).toEqual(['src/a.js'])
  })
})
