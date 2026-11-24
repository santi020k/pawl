import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatJson } from '../src/check/output.ts'
import { CHECK_REPORT_VERSION, readCheckReport } from '../src/check/report-contract.ts'
import { type CheckResult, exitCode } from '../src/check/result.ts'
import { BIOME_PRESET } from '../src/engines/biome/config.ts'
import { type Finding } from '../src/types.ts'
import { link, PACKAGE_ROOT, project } from './helpers.ts'

const result = (extra: Partial<CheckResult> = {}): CheckResult => ({
  findings: [],
  baselined: 0,
  setup: [],
  engines: ['biome'],
  commands: ['biome check .'],
  hasBaseline: false,
  canShrinkBaseline: false,
  nothingToCheck: false,
  ...extra
})

const finding: Finding = {
  file: 'src/a.js',
  line: 1,
  column: 1,
  engine: 'biome',
  engineRule: 'suspicious/noDebugger',
  rule: 'no-debugger',
  severity: 'error',
  message: 'Remove the debugger statement.',
  fixable: true
}

const report = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ ...result(), reportVersion: CHECK_REPORT_VERSION, ...extra })

describe('the JSON check report contract', () => {
  it('keeps the existing result fields and identifies the report version', () => {
    const source = result()
    const decoded: unknown = JSON.parse(formatJson(source))

    expect(decoded).toEqual({ ...source, reportVersion: 1 })
    expect(readCheckReport(formatJson(source), 0)).toMatchObject({ status: 'ok', report: source, exitCode: 0 })
  })

  it('distinguishes findings, warnings and an exceeded warning limit', () => {
    const warning: Finding = { ...finding, severity: 'warn' }

    for (const [source, status] of [
      [result({ findings: [finding] }), 'findings'],
      [result({ findings: [warning] }), 'ok'],
      [result({ findings: [warning], maxWarnings: 0 }), 'findings'],
      [result({ findings: [warning], maxWarnings: 1 }), 'ok']
    ] as const) {
      expect(readCheckReport(formatJson(source), exitCode(source)).status).toBe(status)
    }
  })

  it('keeps engine failures separate from code findings and baseline counts', () => {
    const source = result({
      setup: [{ code: 'engine-failed', message: 'ESLint could not run.' }],
      hasBaseline: true,
      baselined: 12
    })

    expect(readCheckReport(formatJson(source), 2)).toMatchObject({ status: 'setup', exitCode: 2 })
    expect(readCheckReport(formatJson(source), 0).status).toBe('invalid')
    expect(readCheckReport(formatJson(source), 1).status).toBe('invalid')
  })

  it('accepts real baseline allowances and an empty selected scope', () => {
    expect(readCheckReport(formatJson(result({ hasBaseline: true, baselined: 3 })), 0).status).toBe('ok')
    expect(readCheckReport(formatJson(result({ nothingToCheck: true })), 0).status).toBe('ok')
  })

  it('requires the consumer to use the invocation CI mode for setup drift', () => {
    const source = result({ setup: [{ code: 'biome-config-stale', message: 'Run pawl sync.' }] })

    expect(readCheckReport(formatJson(source), 0).status).toBe('ok')
    expect(readCheckReport(formatJson(source), 2, { ci: true }).status).toBe('setup')
    expect(readCheckReport(formatJson(source), 0, { ci: true }).status).toBe('invalid')
    expect(readCheckReport(formatJson(source), 2).status).toBe('invalid')
  })

  it.each(['', '{', '{}\n{}', 'starting check\n{}', 'null', '[]', '{}'])('refuses malformed output %j', stdout => {
    expect(readCheckReport(stdout, 0).status).toBe('invalid')
  })

  it.each([
    { reportVersion: undefined },
    { reportVersion: 2 },
    { findings: [{}] },
    { findings: [{ ...finding, severity: 'off' }] },
    { findings: [{ ...finding, line: 0 }] },
    { findings: [{ ...finding, column: 1.5 }] },
    { findings: [{ ...finding, fixable: 'yes' }] },
    { findings: [{ ...finding, overBaseline: { allowed: 2, found: 1 } }] },
    { setup: [{ code: 'future-setup-code', message: 'Cannot run.' }] },
    { setup: [{ code: 'engine-failed', message: 1 }] },
    { setup: [{ code: 'engine-failed', message: 'Cannot run.', fix: 1 }] },
    { engines: ['not-an-engine'] },
    { commands: [1] },
    { baselined: -1 },
    { baselined: 1.5 },
    { hasBaseline: 'false' },
    { canShrinkBaseline: 1 },
    { nothingToCheck: null },
    { maxWarnings: -1 }
  ])('refuses invalid field shapes %j', fields => {
    expect(readCheckReport(report(fields), 0).status).toBe('invalid')
  })

  it('rejects contradictory baseline and completion metadata', () => {
    for (const fields of [
      { baselined: 1 },
      { canShrinkBaseline: true },
      { findings: [{ ...finding, overBaseline: { allowed: 1, found: 2 } }] },
      { nothingToCheck: true, findings: [finding] },
      { nothingToCheck: true, hasBaseline: true, baselined: 1 },
      { hasBaseline: true, canShrinkBaseline: true, setup: [{ code: 'engine-failed', message: 'Failed.' }] }
    ]) {
      expect(readCheckReport(report(fields), 0).status).toBe('invalid')
    }
  })

  it('accepts additive metadata but never replaces the actual exit code with a claimed success', () => {
    expect(readCheckReport(report({ futureMetadata: { name: 'extra' } }), 0).status).toBe('ok')

    for (const code of [null, -1, 1, 2, 3, 137]) {
      expect(readCheckReport(report({ success: true, exitCode: 0 }), code).status).toBe('invalid')
    }
  })
})

describe('captured CLI reports', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  const run = (files: Record<string, string | object>, args: string[] = []) => {
    const root = project({
      'package.json': { name: 'report-fixture', private: true },
      'biome.json': { extends: [BIOME_PRESET] },
      ...files
    })

    roots.push(root)
    link(root)

    return spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), 'check', '--format', 'json', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CI: 'false', NO_COLOR: '1' },
      timeout: 30_000
    })
  }

  it('validates real Biome findings emitted by the CLI', () => {
    const captured = run({ 'src/a.js': 'debugger\n' })
    const parsed = readCheckReport(captured.stdout, captured.status)

    expect(captured.error).toBeUndefined()
    expect(parsed.status).toBe('findings')

    if (parsed.status !== 'findings') throw new Error(captured.stderr || 'Expected a findings report.')

    expect(parsed.report.findings).toContainEqual(expect.objectContaining({ rule: 'no-debugger' }))
  })

  it('accepts the CLI report when a real source check passes', () => {
    const captured = run({ 'src/a.js': 'export const answer = 42\n' }, ['src/a.js'])

    expect(captured.error).toBeUndefined()
    expect(readCheckReport(captured.stdout, captured.status).status).toBe('ok')
  })

  it('never lets an existing baseline hide an engine failure', () => {
    const files = {
      'src/a.js': 'debugger\n',
      '.pawl/baseline.json': { version: 1, findings: { 'src/a.js': { 'no-debugger': 1 } }, suppressions: {} }
    }
    const allowed = run(files, ['src/a.js'])

    expect(readCheckReport(allowed.stdout, allowed.status)).toMatchObject({
      status: 'ok',
      report: { hasBaseline: true, baselined: 1, findings: [] }
    })

    const failed = run({ ...files, 'biome.json': '{broken' }, ['src/a.js'])
    const parsed = readCheckReport(failed.stdout, failed.status)

    expect(failed.status).toBe(2)
    expect(parsed).toMatchObject({ status: 'setup', report: { hasBaseline: true, canShrinkBaseline: false } })

    if (parsed.status !== 'setup') throw new Error(failed.stderr || 'Expected a setup report.')

    expect(parsed.report.setup.length).toBeGreaterThan(0)
  })

  it('does not turn a setup failure or a pre-report CLI error into success', () => {
    const setup = run({ 'biome.json': '{broken' })

    expect(setup.status).toBe(2)
    expect(readCheckReport(setup.stdout, setup.status).status).toBe('setup')

    const usage = run({}, ['--not-a-pawl-option'])

    expect(usage.status).toBe(2)
    expect(readCheckReport(usage.stdout, usage.status).status).toBe('invalid')
  })
})
