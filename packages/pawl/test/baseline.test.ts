import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyBaseline,
  BASELINE_FILE,
  type Baseline,
  baselineUnreadable,
  blankJsonStrings,
  createBaseline,
  newSuppressions,
  readBaseline,
  scanSuppressions,
  writeBaseline
} from '../src/check/baseline.ts'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { makeIgnore } from '../src/project/ignores.ts'
import { type Finding } from '../src/types.ts'
import { link, project, write } from './helpers.ts'

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

  it('records prototype-shaped filenames and rules as ordinary own keys', () => {
    const keys = ['__proto__', 'constructor', 'toString', 'reviewProbe']
    const findings = keys.flatMap(file => keys.map(rule => finding(file, rule)))
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype)
    const recorded = createBaseline([...findings, ...findings], [])

    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype)
    expect(Object.keys(recorded.findings)).toHaveLength(keys.length)
    for (const file of keys) {
      expect(Object.hasOwn(recorded.findings, file)).toBe(true)
      for (const rule of keys) {
        expect(Object.hasOwn(recorded.findings[file] ?? {}, rule)).toBe(true)
        expect(recorded.findings[file]?.[rule]).toBe(2)
      }
    }
    const root = project()

    writeBaseline(root, recorded)
    expect(readBaseline(root)).toEqual(recorded)
    expect(applyBaseline([...findings, ...findings], readBaseline(root))).toEqual({
      fresh: [],
      baselined: findings.length * 2,
      canShrink: false
    })
    expect(applyBaseline(findings, createBaseline([], []))).toEqual({
      fresh: findings,
      baselined: 0,
      canShrink: false
    })
  })

  it('does not use inherited filename or rule counts', () => {
    const findings = [finding('inherited.ts', 'reviewProbe'), finding('own.ts', 'reviewProbe')]
    const rules: Record<string, number> = {}
    const byFile: Baseline['findings'] = { 'own.ts': rules }

    Object.setPrototypeOf(rules, { reviewProbe: 1 })
    Object.setPrototypeOf(byFile, { 'inherited.ts': { reviewProbe: 1 } })
    expect(applyBaseline(findings, { version: 1, findings: byFile, suppressions: {} })).toEqual({
      fresh: findings,
      baselined: 0,
      canShrink: false
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
  it('counts prototype-shaped filenames without inherited suppression allowances', () => {
    const keys = ['__proto__', 'constructor', 'toString']
    const suppressions = keys.map(file => ({ file, line: 1, text: 'eslint-disable' }))
    const recorded = createBaseline([], suppressions)

    for (const file of keys) {
      expect(Object.hasOwn(recorded.suppressions, file)).toBe(true)
      expect(recorded.suppressions[file]).toBe(1)
    }
    expect(newSuppressions(suppressions, recorded)).toEqual([])
    expect(newSuppressions(suppressions, createBaseline([], [])).map(item => item.file)).toEqual(keys)
    expect(newSuppressions([...suppressions, ...suppressions], recorded)).toHaveLength(keys.length * 2)
    const inherited = createBaseline([], [])

    Object.setPrototypeOf(inherited.suppressions, Object.fromEntries(keys.map(file => [file, 10])))
    expect(newSuppressions(suppressions, inherited).map(item => item.file)).toEqual(keys)
  })

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
    const found = scanSuppressions(root, makeIgnore(['generated/**']))

    expect(found.map(item => `${item.file}:${item.line} ${item.text}`)).toEqual([
      'src/a.ts:1 eslint-disable-next-line',
      'src/a.ts:4 biome-ignore',
      'src/a.ts:5 @ts-expect-error',
      'src/b.vue:1 eslint-disable'
    ])
  })

  it('finds the comments of Oxlint, and those in stylesheets, JSON, GraphQL and YAML', () => {
    // Put together here, so that pawl's check of this file does not count them.
    const comment = (open: string, text: string): string => `${open} ${text}`
    const files = project({
      'src/a.ts': [comment('//', 'oxlint-disable-next-line no-console'), 'console.log(1)', ''].join('\n'),
      'src/b.js': `${comment('/*', 'oxlint-disable */')}\nconsole.log(2) ${comment('//', 'oxlint-disable-line')}\n`,
      'src/a.css': `a {\n  ${comment('/*', 'biome-ignore lint/suspicious/noDuplicateProperties: legacy */')}\n}\n`,
      'data.jsonc': `{\n  ${comment('//', 'biome-ignore lint/suspicious/noDuplicateObjectKeys: legacy')}\n  "a": 1\n}\n`,
      'schema.graphql': `${comment('#', 'biome-ignore lint/style/useNamingConvention: legacy')}\ntype a { b: Int }\n`,
      'ci.yml': `${comment('#', 'eslint-disable yml/no-empty-key')}\na: 1 # a note about eslint\n`,
      'notes.txt': `${comment('//', 'eslint-disable')}\n`
    })

    expect(
      scanSuppressions(files, () => false)
        .map(item => `${item.file}:${item.line} ${item.text}`)
        .sort()
    ).toEqual([
      'ci.yml:1 eslint-disable',
      'data.jsonc:2 biome-ignore',
      'schema.graphql:1 biome-ignore',
      'src/a.css:2 biome-ignore',
      'src/a.ts:1 oxlint-disable-next-line',
      'src/b.js:1 oxlint-disable',
      'src/b.js:2 oxlint-disable-line'
    ])
  })

  it('does not count a JSON string that shows a disable comment, but does count the comment after it', () => {
    const comment = (open: string, text: string): string => `${open} ${text}`
    const files = project({
      '.vscode/snippets.json': [
        '{',
        `  "skip": { "body": "${comment('//', 'eslint-disable-next-line no-console')}" },`,
        `  "escaped": "a \\" ${comment('/*', 'biome-ignore x */')}",`,
        `  "url": "https://example.com/${comment('*', 'eslint-disable')}"`,
        `}  ${comment('//', 'eslint-disable-line')}`,
        ''
      ].join('\n'),
      'tsconfig.json': `{
  ${comment('/*', 'biome-ignore lint: "quoted" */')}
  "a": "${comment('//', '@ts-ignore')}"
}
`
    })

    expect(scanSuppressions(files, () => false).map(item => `${item.file}:${item.line} ${item.text}`)).toEqual([
      '.vscode/snippets.json:5 eslint-disable-line',
      'tsconfig.json:2 biome-ignore'
    ])
    expect(blankJsonStrings('{"a": "x\\"y", "b": 1}')).toBe('{" ": "    ", " ": 1}')
  })

  it('fails only files that gained a comment since the baseline', () => {
    const found = scanSuppressions(root, makeIgnore(['generated/**']))
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

describe('the baseline file, with the real Biome', { timeout: 60_000 }, () => {
  const LEGACY = 'var legacy = 1\nexport default legacy\n'

  const fixture = (files: Record<string, string | object> = {}): string => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      'src/old.js': LEGACY,
      ...files
    })

    link(root)

    return root
  }

  it('is not written by a check that did not complete', async () => {
    // Oxlint is the linter and has no config yet, so the lint part of the check cannot run.
    const root = fixture({ 'pawl.config.json': { engine: 'oxlint' } })
    const first = await check({ root, updateBaseline: true })

    expect(first.setup.map(issue => issue.code)).toContain('oxlint-config-missing')
    expect(first.baselined).toBe(0)
    expect(first.hasBaseline).toBe(false)
    expect(existsSync(join(root, BASELINE_FILE))).toBe(false)

    // An earlier baseline is kept as it was, not replaced by half the findings.
    const kept = { version: 1, findings: { 'src/old.js': { 'no-var': 1, 'pawl/format': 4 } }, suppressions: {} }

    write(root, { [BASELINE_FILE]: kept })

    const second = await check({ root, updateBaseline: true })

    expect(second.hasBaseline).toBe(true)
    expect(readBaseline(root)).toEqual(kept)
  })

  it('stops the check when the file cannot be read, and is written again by "pawl baseline"', async () => {
    const root = fixture()

    await check({ root, updateBaseline: true })

    const recorded = readBaseline(root)

    write(root, { [BASELINE_FILE]: `<<<<<<< HEAD\n${JSON.stringify(recorded)}\n=======\n{}\n>>>>>>> feature\n` })

    const result = await check({ root })

    // Nothing ran: without the baseline every old finding would come back as new.
    expect(result.setup).toEqual([
      {
        code: 'baseline-unreadable',
        message: `${BASELINE_FILE} cannot be read: it is not valid JSON, or not a baseline this version of pawl knows.`,
        fix: 'Resolve the merge conflict in it, or run "pawl baseline" to record the findings again.'
      }
    ])
    expect(result.findings).toEqual([])
    expect(result.commands).toEqual([])
    expect(exitCode(result)).toBe(2)

    await check({ root, updateBaseline: true })

    expect(readBaseline(root)).toEqual(recorded)
    expect((await check({ root })).setup).toEqual([])
  })

  it('counts as unreadable when a newer pawl wrote it', () => {
    const root = fixture({ [BASELINE_FILE]: { version: 2, entries: [] } })

    expect(baselineUnreadable(root)).toBe(true)
    expect(baselineUnreadable(fixture())).toBe(false)
  })
})
