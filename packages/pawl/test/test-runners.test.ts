import { describe, expect, it } from 'vitest'
import { biomeConfig } from '../src/engines/biome/config.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { oxlintConfig } from '../src/engines/oxlint/config.ts'
import { runOxlint } from '../src/engines/oxlint/run.ts'
import { mergeLayers } from '../src/policy/merge.ts'
import { policyProblems } from '../src/policy/schema.ts'
import { type EngineName, type PolicyInput } from '../src/types.ts'
import { project, write } from './helpers.ts'

const resolved = (input: PolicyInput) => mergeLayers([{ input, source: 'test policy' }])
const scopes = { vitest: ['unit/**'], node: ['node/**'] }
const source = {
  'package.json': { name: 'mixed-runners', type: 'module' },
  'node/example.test.ts':
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("works", () => { assert.equal(1, 1); });\n',
  'node/skipped.test.ts': 'import { test } from "node:test";\ntest.skip("skipped", () => {});\n',
  'unit/skipped.test.ts':
    'import { test, expect } from "vitest";\ntest.skip("skipped", () => { expect(1).toBe(1); });\n',
  'unit/example.test.ts': 'import { test } from "vitest";\ntest("missing assertion", () => { const value = 1; });\n'
}

const run = async (engine: EngineName, input: PolicyInput) => {
  const root = project(source)
  const policy = resolved(input)
  const files = Object.keys(source).filter(file => file.endsWith('.ts'))

  if (engine === 'biome') {
    write(root, { 'biome.json': biomeConfig(policy) })

    return runBiome({ root, files })
  }

  write(root, { '.oxlintrc.json': oxlintConfig(policy, { typescript: true }) })

  return runOxlint({ root, files })
}

describe('explicit test runner scopes', () => {
  it.each(['biome', 'oxlint'] as const)(
    'keeps assertions with their runner and skipped checks global under %s',
    async engine => {
      const result = await run(engine, { testRunners: scopes })
      const assertions = result.findings.filter(finding => finding.rule === 'vitest/expect-expect')

      expect(assertions.map(finding => finding.file)).toEqual(['unit/example.test.ts'])
      // Shared safety is never disabled by declaring a different assertion API.
      expect(result.findings).toContainEqual(
        expect.objectContaining({ file: 'unit/skipped.test.ts', rule: 'vitest/no-disabled-tests' })
      )
    }
  )

  it('keeps default behavior when no runner scope is declared', async () => {
    const result = await run('biome', {})

    expect(result.findings).toContainEqual(
      expect.objectContaining({ file: 'node/skipped.test.ts', rule: 'vitest/expect-expect' })
    )
  })

  it('preserves explicit options and scoped rule levels within the declared runner', async () => {
    const result = await run('biome', {
      testRunners: scopes,
      overrides: [{ files: ['unit/**'], rules: { 'vitest/expect-expect': 'warn' } }]
    })

    expect(result.findings).toContainEqual(
      expect.objectContaining({ file: 'unit/example.test.ts', rule: 'vitest/expect-expect', severity: 'warn' })
    )
    expect(
      result.findings.some(
        finding => finding.file === 'node/example.test.ts' && finding.rule === 'vitest/expect-expect'
      )
    ).toBe(false)
  })

  it('rejects narrowing a locked assertion rule, including its Biome alias', () => {
    expect(() => resolved({ testRunners: scopes, locked: ['vitest/expect-expect'] })).toThrow(
      'cannot narrow locked rule'
    )
    expect(() =>
      resolved({
        testRunners: scopes,
        rules: { 'biome:suspicious/useExpect': 'error' },
        locked: ['biome:suspicious/useExpect']
      })
    ).toThrow('cannot narrow locked rule')
    expect(() =>
      resolved({ testRunners: scopes, locked: ['vitest/no-disabled-tests', 'no-only-tests/no-only-tests'] })
    ).not.toThrow()
  })

  it('rejects implicit locked engine aliases and inherited locked runner scopes', () => {
    expect(() => resolved({ testRunners: scopes, locked: ['biome:suspicious/useExpect'] })).toThrow(
      'cannot narrow locked rule'
    )
    expect(() =>
      mergeLayers([
        { input: { locked: ['vitest/expect-expect'] }, source: 'parent' },
        { input: { testRunners: scopes }, source: 'child' }
      ])
    ).toThrow('cannot narrow locked rule')
  })

  it('merges each runner separately and rejects invalid or empty scopes', () => {
    const merged = mergeLayers([
      { input: { testRunners: scopes }, source: 'parent' },
      { input: { testRunners: { vitest: ['packages/unit/**'] } }, source: 'child' }
    ])

    expect(merged.testRunners).toEqual({ node: ['node/**'], vitest: ['packages/unit/**'] })
    expect(() => resolved({ testRunners: {} })).toThrow('at least one runner')
    expect(() => resolved({ testRunners: { vitest: [] } })).toThrow('nonempty positive')
    expect(() => resolved({ testRunners: { vitest: ['!unit/**'] } })).toThrow('exclusions are not supported')
    expect(policyProblems({ testRunners: { other: ['tests/**'] } }).join(' ')).toContain('not an option')
    expect(policyProblems({ testRunners: { vitest: [] } }).join(' ')).toContain('at least 1 item')
    expect(policyProblems({ testRunners: { vitest: [''] } }).join(' ')).toContain('at least 1 character')
  })
})
