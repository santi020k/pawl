import { execFileSync } from 'node:child_process'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { EngineError } from '../src/engines/engine.ts'
import { runEslint } from '../src/engines/eslint/run.ts'
import { checkLanguages } from '../src/engines/languages/check.ts'
import { runOxlint } from '../src/engines/oxlint/run.ts'
import { loadPolicy } from '../src/policy/load.ts'
import { defaultPolicy } from '../src/policy/merge.ts'
import { detect } from '../src/project/detect.ts'
import { changedFiles, changedSince, listFiles } from '../src/project/files.ts'
import { doctor } from '../src/report/doctor.ts'
import { hiddenScan } from '../src/scans/hidden.ts'
import { runScan } from '../src/scans/scan.ts'
import { planMigrate } from '../src/setup/migrate/plan.ts'
import { planPolicyFile } from '../src/setup/plan.ts'
import { link, project, write } from './helpers.ts'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const initGit = (cwd: string): void => {
  git(cwd, 'init')
  git(cwd, 'config', 'user.email', 'test@example.com')
  git(cwd, 'config', 'user.name', 'Test')
}

const fakeBinProject = (packageName: string, binName: string, scriptBody: string): string =>
  project({
    'package.json': { name: 'fake-bin-fixture', type: 'module' },
    [`node_modules/${packageName}/package.json`]: {
      name: packageName,
      version: '1.0.0',
      type: 'module',
      bin: { [binName]: './cli.js' }
    },
    [`node_modules/${packageName}/cli.js`]: scriptBody
  })

describe('trailing-slash and symlinked project roots', { timeout: 60_000 }, () => {
  it('normalizes real ESLint paths, policy sources, doctor file, plan note and migrate error', async () => {
    const real = project({
      'package.json': { name: 'path-fixture', private: true, type: 'module' },
      'pawl.config.json': { rules: { 'no-debugger': 'error' } },
      'eslint.config.mjs': "export default [{ rules: { 'no-debugger': 'error' } }]\n",
      'src/bad.js': 'debugger;\n'
    })

    link(real)

    const parent = project()
    const linked = join(parent, 'linked-root')

    symlinkSync(real, linked)

    const trailing = await runEslint({ root: `${real}/`, files: ['src/bad.js'] })
    const symlinked = await runEslint({ root: linked, files: ['src/bad.js'] })

    expect(trailing.findings.map(finding => finding.file)).toEqual(['src/bad.js'])
    expect(symlinked.findings.map(finding => finding.file)).toEqual(['src/bad.js'])

    expect((await loadPolicy(`${real}/`)).sources).toEqual(['pawl defaults', 'pawl.config.json'])
    expect((await doctor(`${real}/`)).policy.file).toBe('pawl.config.json')

    const notes: string[] = []

    planPolicyFile(`${real}/`, { strict: true }, notes)
    expect(notes[0]).toContain('Add {"strict":true} to pawl.config.json.')

    await expect(planMigrate({ root: `${real}/` })).rejects.toThrow(
      'pawl.config.json already exists. Move it away to migrate from eslint.config.mjs.'
    )
  })
})

describe('Biome and Oxlint failure and report hardening', { timeout: 60_000 }, () => {
  it('allows Oxlint to pass on non-JS files without erroring on unmatched patterns', async () => {
    const root = project({
      'package.json': { name: 'oxlint-unmatched', private: true, type: 'module' },
      '.oxlintrc.json': { rules: { 'no-debugger': 'error' } },
      'README.md': '# Hello\n'
    })

    link(root)

    const result = await runOxlint({ root, files: ['README.md'] })

    expect(result.findings).toEqual([])
  })

  it('stops check with exit code 2 when real Biome or Oxlint config cannot run', async () => {
    const biomeRoot = project({
      'package.json': { name: 'broken-biome', private: true, type: 'module' },
      'biome.json': '{ invalid json',
      'src/a.js': 'var x = 1;\n',
      '.pawl/baseline.json': { version: 1, findings: { 'src/a.js': { 'no-var': 1 } }, suppressions: {} }
    })

    link(biomeRoot)

    const biomeResult = await check({ root: biomeRoot })

    expect(exitCode(biomeResult)).toBe(2)
    expect(biomeResult.setup.some(issue => issue.code === 'engine-failed')).toBe(true)

    const oxlintRoot = project({
      'package.json': { name: 'broken-oxlint', private: true, type: 'module' },
      'pawl.config.json': { engine: 'oxlint' },
      'biome.json': { extends: ['@santi020k/pawl/biome'], linter: { enabled: false } },
      '.oxlintrc.json': '{ invalid json',
      'src/a.js': 'debugger;\n'
    })

    link(oxlintRoot)

    const oxlintResult = await check({ root: oxlintRoot })

    expect(exitCode(oxlintResult)).toBe(2)
    expect(oxlintResult.setup.some(issue => issue.code === 'engine-failed')).toBe(true)
  })

  it.each([
    {
      name: 'exit code 2 even with valid error findings',
      code: 2,
      stdout: {
        diagnostics: [
          {
            severity: 'error',
            message: 'bad',
            category: 'lint/suspicious/noDebugger',
            location: { path: 'a.js', start: { line: 1, column: 1 } }
          }
        ]
      }
    },
    {
      name: 'fatal diagnostic',
      code: 1,
      stdout: { diagnostics: [{ severity: 'fatal', message: 'Plugin crashed', category: 'internalError/io' }] }
    },
    {
      name: 'exit 1 with warning-only diagnostic',
      code: 1,
      stdout: {
        diagnostics: [
          {
            severity: 'warning',
            message: 'warn',
            category: 'lint/suspicious/noExplicitAny',
            location: { path: 'a.ts', start: { line: 1, column: 1 } }
          }
        ]
      }
    },
    {
      name: 'exit 0 with error diagnostic',
      code: 0,
      stdout: {
        diagnostics: [
          {
            severity: 'error',
            message: 'err',
            category: 'lint/suspicious/noDebugger',
            location: { path: 'a.js', start: { line: 1, column: 1 } }
          }
        ]
      }
    },
    {
      name: 'malformed diagnostic entry',
      code: 0,
      stdout: {
        diagnostics: [
          { severity: 'error', message: 'missing category', location: { path: 'a.js', start: { line: -1, column: 1 } } }
        ]
      }
    },
    {
      name: 'unknown severity string with exit 0',
      code: 0,
      stdout: {
        diagnostics: [
          {
            severity: 'oops',
            message: 'unexpected',
            category: 'lint/suspicious/noDebugger',
            location: { path: 'a.js', start: { line: 1, column: 1 } }
          }
        ]
      }
    }
  ])('rejects invalid Biome run ($name)', async ({ code, stdout }) => {
    const root = fakeBinProject(
      '@biomejs/biome',
      'biome',
      `process.stdout.write(JSON.stringify(${JSON.stringify(stdout)}));\nprocess.exitCode = ${code};\n`
    )

    await expect(runBiome({ root })).rejects.toThrow(EngineError)
  })

  it('accepts real Biome info diagnostics on exit 0 while check() exits 2 on forged unknown severity', async () => {
    const infoRoot = project({
      'package.json': { name: 'biome-info', private: true, type: 'module' },
      'biome.json': {
        formatter: { enabled: false },
        assist: { enabled: false },
        linter: { enabled: true, rules: { recommended: false, suspicious: { noConsole: 'info' } } }
      },
      'src/a.js': 'console.log(1);\n'
    })

    link(infoRoot)

    expect((await runBiome({ root: infoRoot, files: ['src/a.js'] })).findings).toEqual([])

    const forged = project({
      'package.json': { name: 'biome-unknown-severity', type: 'module' },
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      'src/a.js': 'debugger;\n',
      'node_modules/@biomejs/biome/package.json': {
        name: '@biomejs/biome',
        version: '2.6.8',
        type: 'module',
        bin: { biome: './cli.js' }
      },
      'node_modules/@biomejs/biome/cli.js':
        "process.stdout.write(JSON.stringify({ diagnostics: [{ severity: 'oops', message: 'bad', category: 'lint/suspicious/noDebugger', location: { path: 'src/a.js', start: { line: 1, column: 1 } } }] }));"
    })
    link(forged)

    const result = await check({ root: forged, files: ['src/a.js'] })

    expect(exitCode(result)).toBe(2)
    expect(result.setup.some(issue => issue.code === 'engine-failed')).toBe(true)
  })

  it.each([
    {
      name: 'exit code 2 even with valid error diagnostic',
      code: 2,
      stdout: {
        diagnostics: [
          {
            message: 'err',
            code: 'eslint(no-debugger)',
            severity: 'error',
            filename: 'a.js',
            labels: [{ span: { line: 1, column: 1 } }]
          }
        ]
      }
    },
    {
      name: 'exit 1 with empty diagnostics',
      code: 1,
      stdout: { diagnostics: [] }
    },
    {
      name: 'exit 1 with warning-only diagnostic',
      code: 1,
      stdout: { diagnostics: [{ message: 'warn', code: 'eslint(no-console)', severity: 'warning', filename: 'a.js' }] }
    },
    {
      name: 'exit 0 with error diagnostic',
      code: 0,
      stdout: { diagnostics: [{ message: 'err', code: 'eslint(no-debugger)', severity: 'error', filename: 'a.js' }] }
    },
    {
      name: 'unknown severity string with exit 0',
      code: 0,
      stdout: {
        diagnostics: [{ message: 'unexpected', code: 'eslint(no-debugger)', severity: 'oops', filename: 'a.js' }]
      }
    },
    {
      name: 'malformed Oxlint report without diagnostics array or invalid span',
      code: 0,
      stdout: { diagnostics: [{ message: 'bad', severity: 'error', labels: [{ span: { line: -2, column: 1 } }] }] }
    }
  ])('rejects invalid Oxlint run ($name)', async ({ code, stdout }) => {
    const root = fakeBinProject(
      'oxlint',
      'oxlint',
      `process.stdout.write(JSON.stringify(${JSON.stringify(stdout)}));\nprocess.exitCode = ${code};\n`
    )

    await expect(runOxlint({ root })).rejects.toThrow(EngineError)
  })
})

describe('Git file filtering and cached discovery separation', () => {
  it('preserves tracked file symlinks while excluding submodule directories and dangling links across Git listings', () => {
    const submodule = project({ 'README.md': '# Submodule\n' })

    initGit(submodule)
    git(submodule, 'add', '.')
    git(submodule, 'commit', '-m', 'sub')

    const repo = project({
      'real.ts': 'export const real = 1\n'
    })

    initGit(repo)
    symlinkSync('real.ts', join(repo, 'linked.ts'))
    symlinkSync('missing-target.ts', join(repo, 'dangling.ts'))
    git(repo, 'add', 'real.ts', 'linked.ts', 'dangling.ts')
    git(repo, 'commit', '-m', 'base')

    execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', submodule, 'sub.test.ts'], {
      cwd: repo,
      stdio: 'pipe'
    })
    git(repo, 'commit', '-m', 'add submodule')
    git(repo, 'branch', 'base-ref')

    // Also modify linked/untracked entries after base-ref for changedFiles and changedSince coverage.
    write(repo, { 'added.ts': 'export const added = 2\n' })
    symlinkSync('added.ts', join(repo, 'added-link.ts'))
    git(repo, 'add', 'added.ts', 'added-link.ts')
    git(repo, 'commit', '-m', 'second')
    write(repo, { 'working-real.ts': 'export const work = 3\n' })
    symlinkSync('working-real.ts', join(repo, 'working-link.ts'))

    const listed = listFiles(repo)

    expect(listed).toContain('real.ts')
    expect(listed).toContain('linked.ts')
    expect(listed).not.toContain('sub.test.ts')
    expect(listed).not.toContain('dangling.ts')

    const changed = changedFiles(repo) ?? []

    expect(changed).toContain('working-real.ts')
    expect(changed).toContain('working-link.ts')
    expect(changed).not.toContain('sub.test.ts')

    const since = changedSince(repo, 'base-ref')

    expect(since).toContain('added.ts')
    expect(since).toContain('added-link.ts')
    expect(since).toContain('working-link.ts')
    expect(since).not.toContain('sub.test.ts')
    expect(since).not.toContain('dangling.ts')
  })

  it('preserves whole-project Cargo behavior when projectFiles is supplied without options.files', async () => {
    const binDir = project()
    const finding = (file: string) =>
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          message: 'needless return',
          level: 'warning',
          code: { code: 'clippy::needless_return' },
          spans: [{ file_name: file, line_start: 1, column_start: 1, is_primary: true }]
        }
      })

    const clippyOutput = join(binDir, 'clippy.jsonl')

    writeFileSync(
      clippyOutput,
      `${finding('src/lib.rs')}\n${finding('src/other.rs')}\n{"reason":"build-finished","success":true}\n`
    )
    writeFileSync(
      join(binDir, 'cargo'),
      `#!/bin/sh
if [ "$1" = "clippy" ]; then
  cat ${JSON.stringify(clippyOutput)}
fi
`
    )
    execFileSync('chmod', ['+x', join(binDir, 'cargo')])

    const rustRoot = project({
      'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub fn ok() -> i32 { return 1; }\n',
      'src/other.rs': 'pub fn other() -> i32 { return 2; }\n'
    })
    const policy = { ...defaultPolicy(), languages: { rust: { lint: true, format: false } } }
    const detection = detect(rustRoot)
    const oldPath = process.env.PATH

    try {
      process.env.PATH = `${binDir}${delimiter}${oldPath ?? ''}`

      const whole = await checkLanguages({
        root: rustRoot,
        policy,
        detection,
        projectFiles: ['src/lib.rs'],
        ignored: () => false
      })

      expect(whole.setup).toEqual([])
      expect(whole.findings.map(item => item.file)).toEqual(['src/lib.rs', 'src/other.rs'])

      const scoped = await checkLanguages({
        root: rustRoot,
        policy,
        detection,
        files: ['src/lib.rs'],
        ignored: () => false
      })

      expect(scoped.setup).toEqual([])
      expect(scoped.findings.map(item => item.file)).toEqual(['src/lib.rs'])
    } finally {
      process.env.PATH = oldPath
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  it('still runs alsoLists agent scans outside git repos when projectFiles is reused', () => {
    const root = project({
      'src/a.ts': 'export const a = 1\n',
      '.cursor/rules/backdoor.md': 'visible\u200Bhidden\n'
    })
    const findings = runScan(hiddenScan, {
      root,
      policy: defaultPolicy(),
      projectFiles: ['src/a.ts']
    })

    expect(findings.map(finding => finding.file)).toEqual(['.cursor/rules/backdoor.md'])
  })
})
