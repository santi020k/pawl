import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBaseline, BASELINE_FILE, createBaseline, readBaseline } from '../src/check/baseline.ts'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { type Finding } from '../src/types.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const BROKEN = 'export const broken = (a =>\n'

const run = (root: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0' }
  })

  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** A project with an old finding the baseline may take, and a file that does not parse. */
const biomeProject = (): string => {
  const root = project({
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'biome.json': { extends: ['@santi020k/pawl/biome'] },
    'src/old.js': 'var legacy = 1\nexport default legacy\n',
    'src/broken.js': BROKEN
  })

  link(root)

  return root
}

const eslintProject = (): string => {
  const root = project({
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'pawl.config.json': { engine: 'eslint', formatter: 'prettier' },
    '.prettierrc.json': '{}\n',
    '.prettierignore': 'src/broken.js\n',
    'eslint.config.js': "export default [{ rules: { 'no-debugger': 'error' } }]\n",
    'src/old.js': 'debugger\n',
    'src/broken.js': BROKEN
  })

  link(root, { eslint: true, prettier: true })

  return root
}

const parseRules = (findings: readonly Finding[]): string[] =>
  findings.filter(finding => finding.engineRule === 'parse').map(finding => `${finding.file} ${finding.rule}`)

describe('a file that does not parse, and the baseline', { timeout: 60_000 }, () => {
  for (const [engine, fixture, rule] of [
    ['Biome', biomeProject, 'biome:parse'],
    ['ESLint', eslintProject, 'eslint:parse']
  ] as const) {
    it(`is left out of the baseline, and keeps failing the check, under ${engine}`, async () => {
      const root = fixture()
      const recorded = await check({ root, updateBaseline: true })
      const baseline = readBaseline(root)

      // The old finding is accepted; the parse error is not, and is what the run reports.
      expect(Object.keys(baseline?.findings ?? {})).toContain('src/old.js')
      expect(Object.keys(baseline?.findings['src/broken.js'] ?? {})).not.toContain(rule)
      expect(new Set(parseRules(recorded.findings))).toEqual(new Set([`src/broken.js ${rule}`]))
      expect(recorded.baselined).toBeGreaterThan(0)

      const after = await check({ root })

      expect(parseRules(after.findings)).toContain(`src/broken.js ${rule}`)
      expect(after.findings.every(finding => finding.file === 'src/broken.js')).toBe(true)
      expect(exitCode(after)).toBe(1)
    })
  }

  it('is not accepted where a baseline an earlier pawl wrote counts it', async () => {
    const root = eslintProject()

    write(root, {
      [BASELINE_FILE]: {
        version: 1,
        findings: { 'src/broken.js': { 'eslint:parse': 1 }, 'src/old.js': { 'no-debugger': 1 } },
        suppressions: {}
      }
    })

    const result = await check({ root })

    expect(parseRules(result.findings)).toEqual(['src/broken.js eslint:parse'])
    expect(result.baselined).toBe(1)
    expect(exitCode(result)).toBe(1)
  })

  it('is named by "pawl baseline", which exits with 1, and by init', () => {
    const recorded = run(biomeProject(), 'baseline')

    expect(recorded.code).toBe(1)
    expect(recorded.stdout).toContain('1 file did not parse, so the baseline leaves its syntax errors out')
    expect(recorded.stdout).toMatch(/ {2}src\/broken\.js:\d+:\d+ {2}.+ \[biome:parse\]/)

    const clean = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      'src/a.js': 'export const a = 1\n'
    })

    link(clean)
    expect(run(clean, 'baseline')).toMatchObject({ code: 0 })

    const init = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/broken.js': BROKEN
    })

    link(init)

    const initialized = run(init, 'init', '--yes', '--no-install', '--no-editor')

    expect(initialized.code).toBe(0)
    expect(initialized.stdout).toContain('1 file did not parse')
    expect(initialized.stdout).toContain('src/broken.js:')
  })

  it('counts no parse error in createBaseline and applyBaseline', () => {
    const parse: Finding = {
      file: 'a.vue',
      line: 1,
      column: 1,
      engine: 'eslint',
      engineRule: 'parse',
      rule: 'eslint:parse',
      severity: 'error',
      message: 'Parsing error: Unexpected token',
      fixable: false
    }
    const other: Finding = { ...parse, engineRule: 'no-var', rule: 'no-var', message: 'Unexpected var.' }
    const baseline = createBaseline([parse, other], [])

    expect(baseline.findings).toEqual({ 'a.vue': { 'no-var': 1 } })
    expect(
      applyBaseline([parse, other], { ...baseline, findings: { 'a.vue': { 'eslint:parse': 1, 'no-var': 1 } } })
    ).toEqual({ fresh: [parse], baselined: 1, canShrink: false })
  })
})
