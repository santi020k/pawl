import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyBaseline, createBaseline } from '../src/check/baseline.ts'
import { check } from '../src/check/check.ts'
import { formatAgent } from '../src/check/output.ts'
import { exitCode } from '../src/check/result.ts'
import { prettierConfig } from '../src/engines/prettier/config.ts'
import { parsePrettierErrors, prettierExclusions, runPrettier } from '../src/engines/prettier/run.ts'
import { loadPolicy } from '../src/policy/load.ts'
import { defaultPolicy } from '../src/policy/merge.ts'
import { configIgnores } from '../src/project/ignores.ts'
import { type Finding } from '../src/types.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

// What Prettier 3 printed on stderr, recorded from the real binary.
const ONE_TS = [
  '[error] src/a.ts: SyntaxError: Expression expected. (1:12)',
  '[error] > 1 | const a = (',
  '[error]     |            ^',
  '[error]   2 |',
  ''
].join('\n')

const TWO_TS = [
  ONE_TS.trimEnd(),
  '[error] src/b.ts: SyntaxError: Expression expected. (1:11)',
  '[error] > 1 | const c = ;',
  '[error]     |           ^',
  '[error]   2 | let x = 1 +;',
  '[error]   3 |',
  ''
].join('\n')

const JSON_AND_CSS = [
  '[error] src/bad.json: SyntaxError: Unexpected token (1:8)',
  '[error] > 1 | { "a": }',
  '[error]     |        ^',
  '[error]   2 |',
  '[error] src/bad.css: SyntaxError: CssSyntaxError: Unclosed block (1:1)',
  '[error] > 1 | a { color: red;; ',
  '[error]     | ^',
  '[error]   2 |',
  ''
].join('\n')

const BROKEN_CONFIG = [
  '[error] Invalid configuration for file "/tmp/x/a.ts":',
  '[error] JSON Error in "/tmp/x/.prettierrc.json":',
  '[error] Unexpected token "}"(\\u{7d}), "{ "semi": }',
  '[error] " is not valid JSON',
  ''
].join('\n')

const summary = (stderr: string, targets: string[]): unknown => {
  const { findings, complete } = parsePrettierErrors(stderr, targets)

  return { complete, found: findings.map(finding => `${finding.file}:${finding.line}:${finding.column}`) }
}

describe('parsePrettierErrors', () => {
  it('reads one broken file, with the line and column Prettier names', () => {
    const { findings, complete } = parsePrettierErrors(ONE_TS, ['src/a.ts'])

    expect(complete).toBe(true)
    expect(findings).toEqual([
      {
        file: 'src/a.ts',
        line: 1,
        column: 12,
        engine: 'prettier',
        engineRule: 'parse',
        rule: 'prettier:parse',
        severity: 'error',
        message: 'SyntaxError: Expression expected. (1:12)',
        fixable: false
      }
    ])
  })

  it('reads a block that came out in colour', () => {
    const red = (text: string): string => `\u001b[31m${text}\u001b[39m`
    const stderr = [
      `[${red('error')}] src/a.ts: SyntaxError: Expression expected. (1:12)`,
      `[${red('error')}] \u001b[0m\u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 1 |\u001b[39m const a = (`,
      ''
    ].join('\n')

    expect(parsePrettierErrors(stderr, ['.'])).toMatchObject({ complete: true, findings: [{ file: 'src/a.ts' }] })
  })

  it('reads several broken files, JSON and CSS too', () => {
    expect(summary(TWO_TS, ['src/a.ts', 'src/b.ts', 'src/ok.ts'])).toEqual({
      complete: true,
      found: ['src/a.ts:1:12', 'src/b.ts:1:11']
    })
    expect(summary(JSON_AND_CSS, ['src/bad.json', 'src/bad.css'])).toEqual({
      complete: true,
      found: ['src/bad.json:1:8', 'src/bad.css:1:1']
    })
  })

  it('accepts a folder or the whole project as the target', () => {
    expect(summary(TWO_TS, ['src'])).toMatchObject({ complete: true })
    expect(summary(TWO_TS, ['.'])).toMatchObject({ complete: true })
  })

  it('takes a message without a position as line 1, column 1', () => {
    expect(summary('[error] src/a.ts: SyntaxError: Unexpected end\n', ['src/a.ts'])).toEqual({
      complete: true,
      found: ['src/a.ts:1:1']
    })
  })

  it('is not complete for anything but syntax errors', () => {
    expect(summary(BROKEN_CONFIG, ['src/a.ts'])).toEqual({ complete: false, found: [] })
    expect(summary('', ['src/a.ts'])).toEqual({ complete: false, found: [] })
    expect(summary("[error] Cannot find package 'nope' imported from /x/noop.js\n", ['src/a.ts'])).toEqual({
      complete: false,
      found: []
    })
  })

  it('is not complete when a syntax error is mixed with another error or a warning', () => {
    expect(summary(`${ONE_TS}[error] Cannot find module "prettier-plugin-x"\n`, ['src/a.ts'])).toEqual({
      complete: false,
      found: ['src/a.ts:1:12']
    })
    expect(summary(`${BROKEN_CONFIG}${ONE_TS}`, ['src/a.ts'])).toMatchObject({ complete: false })
    expect(summary(`${ONE_TS}[warn] something else\n`, ['src/a.ts'])).toMatchObject({ complete: false })
    expect(summary(`[error] Error: boom\n${ONE_TS}`, ['src/a.ts'])).toMatchObject({ complete: false })
  })

  it('is not complete for a file that was not checked', () => {
    expect(summary(ONE_TS, ['src/other.ts'])).toMatchObject({ complete: false })
    expect(summary(ONE_TS.replace('src/a.ts', '/etc/a.ts'), ['.'])).toMatchObject({ complete: false })
    expect(summary(ONE_TS.replace('src/a.ts', '../a.ts'), ['.'])).toMatchObject({ complete: false })
  })

  it('does not take a code frame line outside a syntax error block', () => {
    expect(summary('[error] > 1 | const a = (\n', ['.'])).toMatchObject({ complete: false })
  })
})

describe('a file the real Prettier cannot parse', { timeout: 60_000 }, () => {
  const fixture = (prettierrc = `${JSON.stringify(prettierConfig(defaultPolicy()))}\n`): string => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'eslint', formatter: 'prettier' },
      '.prettierrc.json': prettierrc,
      'eslint.config.js': 'export default []\n',
      'src/broken.ts': 'const a = (\n',
      'src/loose.ts': 'export const  b = 1;\n'
    })

    link(root, { eslint: true, prettier: true })

    return root
  }

  it('is a finding on that file, next to the formatting findings of the others', async () => {
    const result = await check({ root: fixture() })
    const prettier = result.findings.filter(finding => finding.engine === 'prettier' && finding.file.startsWith('src/'))

    expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
    expect(prettier.map(finding => `${finding.file} ${finding.rule}`).sort()).toEqual([
      'src/broken.ts prettier:parse',
      'src/loose.ts pawl/format'
    ])
    expect(prettier.find(finding => finding.rule === 'prettier:parse')).toMatchObject({
      line: 1,
      column: 12,
      severity: 'error',
      engineRule: 'parse',
      fixable: false
    })
    expect(exitCode(result)).toBe(1)
  })

  it('is read the same when the environment asks for colour, as Turborepo does', async () => {
    vi.stubEnv('FORCE_COLOR', '1')

    try {
      const result = await check({ root: fixture() })

      expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
      expect(result.findings.filter(finding => finding.rule === 'prettier:parse')).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('is never accepted by the baseline, and reported to an agent with no fix to run', async () => {
    const result = await check({ root: fixture() })
    const { findings } = result
    const parse = findings.filter(finding => finding.rule === 'prettier:parse')
    const earlier = { version: 1 as const, findings: { 'src/broken.ts': { 'prettier:parse': 1 } }, suppressions: {} }

    // Prettier checked nothing in a file it cannot parse, so the file must keep failing until it parses.
    expect(createBaseline(parse, []).findings).toEqual({})
    expect(applyBaseline(parse, earlier).fresh).toEqual(parse)

    const [line] = formatAgent({ ...result, findings: parse, setup: [] })
      .split('\n')
      .map(text => JSON.parse(text) as Record<string, unknown>)

    expect(line).toMatchObject({ file: 'src/broken.ts', line: 1, rule: 'prettier:parse' })
    expect(line).not.toHaveProperty('fix')
  })

  it('is explained by its name', () => {
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), 'explain', 'prettier:parse'], {
      cwd: fixture(),
      encoding: 'utf8',
      env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1' }
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('prettier:parse')
    expect(result.stdout).toContain('Checked by:  Prettier')
  })

  it('is a setup problem when Prettier cannot load a plugin or a parser, though it exits with 1', async () => {
    // Exit code 1 is also what Prettier gives for files that only need formatting, with none listed here.
    for (const config of [{ plugins: ['prettier-plugin-that-is-not-installed'] }, { parser: 'no-such-parser' }]) {
      const result = await check({ root: fixture(`${JSON.stringify(config)}\n`) })
      const failed = result.setup.filter(issue => issue.code === 'engine-failed')

      expect(failed, JSON.stringify(config)).toHaveLength(1)
      expect(exitCode(result)).toBe(2)
    }
  })

  it('still runs when the config only has an option Prettier warns about', async () => {
    const config = { ...prettierConfig(defaultPolicy()), someOptionPrettierDoesNotKnow: true }
    const result = await check({ root: fixture(`${JSON.stringify(config)}\n`) })

    expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
    expect(
      result.findings
        .filter(finding => finding.engine === 'prettier' && finding.file.startsWith('src/'))
        .map(finding => `${finding.file} ${finding.rule}`)
        .sort()
    ).toEqual(['src/broken.ts prettier:parse', 'src/loose.ts pawl/format'])
  })

  it('stays a setup problem when the Prettier config is broken', async () => {
    const result = await check({ root: fixture('{ "semi": }\n') })
    const failed = result.setup.filter(issue => issue.code === 'engine-failed')

    expect(failed).toHaveLength(1)
    expect(failed[0]?.message).toContain('prettier')
    expect(result.findings.filter(finding => finding.rule === 'prettier:parse')).toEqual([])
    expect(exitCode(result)).toBe(2)
  })
})

describe('the files the real Prettier is given', { timeout: 60_000 }, () => {
  const fixture = (): string => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'eslint', formatter: 'prettier', ignore: ['generated', 'src/legacy/*.js'] },
      '.prettierrc.json': `${JSON.stringify(prettierConfig(defaultPolicy()))}\n`,
      'eslint.config.js': 'export default []\n',
      'generated/g.js': 'export const   g = {a:1}\n',
      'src/legacy/old.js': 'export const   o = {a:1}\n',
      'src/legacy/keep.ts': 'export const   k = {a:1}\n',
      // A folder the default ignores skip, whose front matter a Markdown formatter would rewrite.
      '.changeset/c.md': '---\n"x":    patch\n---\n\n*  item\n',
      'src/s.js': 'export const   s = {a:1}\n'
    })

    link(root, { eslint: true, prettier: true })

    return root
  }
  const unformatted = (result: { findings: readonly Finding[] }): string[] =>
    result.findings
      // The config files the fixture writes are not what this is about.
      .filter(finding => finding.rule === 'pawl/format' && !finding.file.endsWith('.json'))
      .map(finding => finding.file)
      .sort()

  it("leave out what the policy and pawl's defaults skip, as the other engines do", async () => {
    const root = fixture()
    const ignore = configIgnores(await loadPolicy(root))

    // Prettier itself does not look at them, so `pawl fix` does not rewrite them either.
    expect(unformatted(await runPrettier({ root, ignore }))).toEqual(['src/legacy/keep.ts', 'src/s.js'])
    expect(unformatted(await runPrettier({ root }))).toEqual([
      '.changeset/c.md',
      'generated/g.js',
      'src/legacy/keep.ts',
      'src/legacy/old.js',
      'src/s.js'
    ])
    expect(unformatted(await check({ root }))).toEqual(['src/legacy/keep.ts', 'src/s.js'])
    expect(prettierExclusions(['generated', 'src/legacy/*.js', '!keep'])).toEqual([
      '!**/generated',
      '!**/generated/**',
      '!src/legacy/*.js',
      '!src/legacy/*.js/**'
    ])
  })

  it('include what the .gitignore lists when the policy does not follow it', async () => {
    const root = fixture()

    write(root, { '.gitignore': 'src/s.js\n' })
    expect(unformatted(await runPrettier({ root, ignore: ['generated', 'src/legacy'] }))).toEqual(['.changeset/c.md'])
    expect(unformatted(await runPrettier({ root, ignore: ['generated', 'src/legacy'], gitignore: false }))).toEqual([
      '.changeset/c.md',
      'src/s.js'
    ])
  })

  it('include a file the policy takes back with "!", by name', async () => {
    const root = fixture()

    write(root, {
      'pawl.config.json': {
        engine: 'eslint',
        formatter: 'prettier',
        ignore: ['generated', '!generated/keep.js', 'src/legacy/*.js']
      },
      'generated/keep.js': 'export const   k = {a:1}\n'
    })

    const ignore = configIgnores(await loadPolicy(root))

    expect(unformatted(await runPrettier({ root, ignore }))).toEqual([
      'generated/keep.js',
      'src/legacy/keep.ts',
      'src/s.js'
    ])
    expect(unformatted(await runPrettier({ root, ignore, files: ['src'] }))).toEqual(['src/legacy/keep.ts', 'src/s.js'])
    expect(unformatted(await runPrettier({ root, ignore, files: ['generated'] }))).toEqual(['generated/keep.js'])
  })

  it('pass over a skipped file that is named, without an error', async () => {
    const result = await check({ root: fixture(), files: ['generated/g.js', '.changeset/c.md', 'src/s.js'] })

    expect(result.setup).toEqual([])
    expect(unformatted(result)).toEqual(['src/s.js'])
  })
})
