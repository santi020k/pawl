import { describe, expect, it } from 'vitest'
import { applyBaseline, createBaseline, newSuppressions, scanSuppressions } from '../src/baseline.ts'
import { type Finding } from '../src/types.ts'
import { project } from './helpers.ts'

const finding = (file: string, rule: string, line = 1): Finding => ({
  file,
  line,
  column: 1,
  engine: 'biome',
  engineRule: rule,
  rule,
  severity: 'error',
  message: rule,
  fixable: false
})

describe('baseline', () => {
  const existing = [finding('a.ts', 'no-var', 1), finding('a.ts', 'no-var', 5), finding('b.ts', 'eqeqeq')]
  const baseline = createBaseline(existing, [])

  it('counts findings per file and rule, with sorted keys', () => {
    expect(baseline).toEqual({
      version: 1,
      findings: { 'a.ts': { 'no-var': 2 }, 'b.ts': { eqeqeq: 1 } },
      suppressions: {}
    })
  })

  it('reports everything when there is no baseline', () => {
    expect(applyBaseline(existing, undefined)).toEqual({ fresh: existing, baselined: 0, canShrink: false })
  })

  it('hides what the baseline allows, even after lines move', () => {
    const moved = [finding('a.ts', 'no-var', 40), finding('a.ts', 'no-var', 90), finding('b.ts', 'eqeqeq', 7)]

    expect(applyBaseline(moved, baseline)).toEqual({ fresh: [], baselined: 3, canShrink: false })
  })

  it('reports new rules and new files', () => {
    const result = applyBaseline([...existing, finding('a.ts', 'no-debugger'), finding('c.ts', 'no-var')], baseline)

    expect(result.fresh.map(item => `${item.file} ${item.rule}`)).toEqual(['a.ts no-debugger', 'c.ts no-var'])
    expect(result.baselined).toBe(3)
  })

  it('reports the whole group when a file has more of a rule than allowed', () => {
    const result = applyBaseline([...existing, finding('a.ts', 'no-var', 9)], baseline)

    expect(result.fresh).toHaveLength(3)
    expect(result.fresh[0]?.overBaseline).toEqual({ allowed: 2, found: 3 })
    expect(result.baselined).toBe(1)
  })

  it('notices when the baseline can be tightened', () => {
    expect(applyBaseline([finding('a.ts', 'no-var'), finding('b.ts', 'eqeqeq')], baseline).canShrink).toBe(true)
    expect(applyBaseline([finding('a.ts', 'no-var'), finding('a.ts', 'no-var')], baseline).canShrink).toBe(true)
  })
})

describe('disable-comment ratchet', () => {
  const root = project({
    'src/a.ts': [
      '// eslint-disable-next-line no-console',
      'console.log(1)',
      'const text = "say eslint-disable in a string"',
      '/* biome-ignore lint/suspicious/noExplicitAny: legacy */',
      '// @ts-expect-error legacy',
      '// eslint-enable'
    ].join('\n'),
    'src/b.vue': '<!-- eslint-disable -->\n',
    'src/readme.md': '// @ts-ignore\n',
    'dist/out.js': '// @ts-nocheck\n',
    'generated/api.ts': '// @ts-nocheck\n'
  })

  it('finds comments that switch a check off, in source files only', () => {
    const found = scanSuppressions(root, ['generated/**'])

    expect(found.map(item => `${item.file}:${item.line} ${item.text}`)).toEqual([
      'src/a.ts:1 eslint-disable-next-line',
      'src/a.ts:4 biome-ignore',
      'src/a.ts:5 @ts-expect-error',
      'src/b.vue:1 eslint-disable'
    ])
  })

  it('fails only files that gained a comment since the baseline', () => {
    const found = scanSuppressions(root, ['generated/**'])
    const baseline = createBaseline(
      [],
      found.filter(item => item.line !== 5)
    )
    const fresh = newSuppressions(found, baseline)

    expect(newSuppressions(found, createBaseline([], found))).toEqual([])
    expect(newSuppressions(found, undefined)).toEqual([])
    expect(fresh.map(item => `${item.file}:${item.line}`)).toEqual(['src/a.ts:1', 'src/a.ts:4', 'src/a.ts:5'])
    expect(fresh[0]).toMatchObject({
      rule: 'pawl/no-new-disable',
      engine: 'pawl',
      severity: 'error',
      overBaseline: { allowed: 2, found: 3 }
    })
  })
})
