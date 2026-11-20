import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalName, defaultLevel, findRule, getRule, getRuleByBiome, RULES } from '../src/catalog/rules.ts'
import { BIOME_VERSION } from '../src/engines/biome/config.ts'
import { OXLINT_RULES } from '../src/engines/oxlint/rules.ts'
import { PACKAGE_ROOT } from './helpers.ts'

const require = createRequire(import.meta.url)

interface Schema {
  $defs: Record<string, { properties?: Record<string, unknown> }>
}

const schema = require('@biomejs/biome/configuration_schema.json') as Schema

describe('rule catalog', () => {
  it('has unique names and unique Biome mappings', () => {
    const names = RULES.map(rule => rule.name)
    const biome = RULES.flatMap(rule => (rule.biome ? [rule.biome] : []))

    expect(new Set(names).size).toBe(names.length)
    expect(new Set(biome).size).toBe(biome.length)
  })

  it('maps only to rules that exist in the pinned Biome, in the right group', () => {
    const missing = RULES.filter(rule => {
      if (!rule.biome) return false

      const [group, name] = rule.biome.split('/') as [string, string]
      const definition = schema.$defs[group.charAt(0).toUpperCase() + group.slice(1)]

      return definition?.properties?.[name] === undefined
    })

    expect(missing.map(rule => rule.biome)).toEqual([])
  })

  it('lists a rule Biome has no equivalent for only when Oxlint enforces it', () => {
    const unenforced = RULES.filter(rule => !rule.biome && rule.tag !== 'pawl' && OXLINT_RULES[rule.name] === undefined)

    expect(unenforced.map(rule => rule.name)).toEqual([])
  })

  it('pins the Biome version it was tested with', () => {
    const manifest = require('@biomejs/biome/package.json') as { version: string }
    const workspace = readFileSync(join(PACKAGE_ROOT, '../../pnpm-workspace.yaml'), 'utf8')

    expect(manifest.version).toBe(BIOME_VERSION)
    expect(workspace).toMatch(new RegExp(`['"]@biomejs/biome['"]: ${BIOME_VERSION.replaceAll('.', '\\.')}\\n`))
  })

  it('gives every guardrail rule advice an agent can act on', () => {
    const silent = RULES.filter(
      rule => rule.guardrail && rule.level !== 'off' && !rule.advice && rule.name !== 'no-useless-catch'
    )

    expect(silent.map(rule => rule.name)).toEqual([])
  })

  it('resolves aliases to the rule they stand for', () => {
    expect(getRule('@typescript-eslint/no-unused-vars')?.name).toBe('no-unused-vars')
    expect(canonicalName('vitest/no-focused-tests')).toBe('no-only-tests/no-only-tests')
    expect(canonicalName('not-a-rule')).toBe('not-a-rule')

    const names = RULES.flatMap(rule => [rule.name, ...(rule.aliases ?? [])])

    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps unstable Biome rules off unless the policy is strict', () => {
    const unstable = RULES.filter(rule => rule.biome?.startsWith('nursery/'))

    expect(unstable.length).toBeGreaterThan(0)
    expect(unstable.filter(rule => rule.level !== 'off' || !rule.nursery).map(rule => rule.name)).toEqual([])
  })

  it('uses the strict level only when the policy is strict', () => {
    expect(defaultLevel('@typescript-eslint/no-explicit-any', false)).toBe('warn')
    expect(defaultLevel('@typescript-eslint/no-explicit-any', true)).toBe('error')
    expect(defaultLevel('not-a-rule', true)).toBe('off')
  })

  it('finds a rule by neutral name, Biome name, or short name', () => {
    const expected = getRule('no-console')

    expect(findRule('no-console')).toBe(expected)
    expect(findRule('suspicious/noConsole')).toBe(expected)
    expect(findRule('noConsole')).toBe(expected)
    expect(findRule('no-explicit-any')?.name).toBe('@typescript-eslint/no-explicit-any')
    expect(getRuleByBiome('suspicious/noDebugger')?.name).toBe('no-debugger')
    expect(findRule('nope')).toBeUndefined()
  })
})
