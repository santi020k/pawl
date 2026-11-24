import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { type Baseline } from '../src/check/baseline.ts'
import { BASELINE_GROWTH, baselineGrowth } from '../src/check/baseline-growth.ts'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { link, project, write } from './helpers.ts'

const baseline = (overrides: Partial<Baseline> = {}): Baseline => ({
  version: 1,
  findings: { 'src/a.js': { 'no-console': 1 } },
  suppressions: { 'src/a.js': 1 },
  tests: { 'src/a.test.js': { assertions: 4, skipped: 0 } },
  ...overrides
})

describe('what a baseline allows that the one before did not', () => {
  it('is nothing for the same baseline, or one that allows less', () => {
    expect(baselineGrowth(baseline(), baseline())).toEqual([])
    expect(baselineGrowth(baseline(), baseline({ findings: {}, suppressions: {} }))).toEqual([])
    expect(baselineGrowth(baseline(), undefined)).toEqual([])
  })

  it('names more findings, more disable comments, fewer assertions, more skips and a floor that is gone', () => {
    const after = baseline({
      findings: { 'src/a.js': { 'no-console': 3 }, 'src/b.js': { eqeqeq: 1 } },
      suppressions: { 'src/a.js': 2 },
      tests: { 'src/b.test.js': { assertions: 1, skipped: 0 } }
    })
    const weaker = baseline({ tests: { 'src/a.test.js': { assertions: 2, skipped: 1 } } })

    expect(baselineGrowth(baseline(), after)).toEqual([
      'src/a.js: 1 more disable comment',
      'src/a.js: 2 more no-console findings',
      'src/a.test.js: no longer counted',
      'src/b.js: 1 more eqeqeq finding'
    ])
    expect(baselineGrowth(baseline(), weaker)).toEqual([
      'src/a.test.js: 1 more skipped test',
      'src/a.test.js: 2 assertions fewer'
    ])
  })

  it('counts a whole new baseline, as on the branch that adopts pawl', () => {
    expect(baselineGrowth(undefined, baseline())).toContain('src/a.js: 1 more no-console finding')
  })
})

const git = (root: string, ...args: string[]): string => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: root,
    encoding: 'utf8'
  })

  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)

  return result.stdout
}

/** A repository on `feature`, whose baseline allows one more finding than the one on `main`. */
const grown = (): string => {
  const root = project({
    'package.json': { name: 'app', type: 'module' },
    'src/a.js': 'export const a = 1\n',
    'biome.json': { extends: ['@santi020k/pawl/biome'] },
    '.gitignore': 'node_modules\n',
    '.pawl/baseline.json': baseline({ tests: {} })
  })

  link(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'init')
  git(root, 'checkout', '-qb', 'feature')
  write(root, { '.pawl/baseline.json': baseline({ tests: {}, findings: { 'src/a.js': { 'no-console': 2 } } }) })
  git(root, 'commit', '-qam', 'record the findings')

  return root
}

describe('a check since a ref, when the baseline allows more', () => {
  it('fails at the baseline file and says how a person accepts it', async () => {
    const root = grown()
    const result = await check({ root, since: 'main' })
    const finding = result.findings.find(item => item.rule === BASELINE_GROWTH)

    expect(finding).toMatchObject({ file: '.pawl/baseline.json', severity: 'error' })
    expect(finding?.message).toContain('src/a.js: 1 more no-console finding')
    expect(finding?.message).toContain('Pawl-Baseline: accept')
    expect(exitCode(result)).toBe(1)
  })

  it('passes once a commit on the branch carries the trailer, and without --since', async () => {
    const root = grown()

    expect((await check({ root })).findings.filter(item => item.rule === BASELINE_GROWTH)).toEqual([])

    git(root, 'commit', '-q', '--allow-empty', '-m', 'accept the findings\n\nPawl-Baseline: accept')

    expect((await check({ root, since: 'main' })).findings.filter(item => item.rule === BASELINE_GROWTH)).toEqual([])
  })

  it('is off when the policy turns the rule off', async () => {
    const root = grown()

    write(root, { 'pawl.config.json': { rules: { [BASELINE_GROWTH]: 'off' } } })

    expect((await check({ root, since: 'main' })).findings.filter(item => item.rule === BASELINE_GROWTH)).toEqual([])
  })
})
