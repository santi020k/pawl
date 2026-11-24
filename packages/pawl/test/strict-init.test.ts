import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASELINE_FILE } from '../src/check/baseline.ts'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { planInit, recordBaseline } from '../src/setup/init.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const run = (root: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '', NO_COLOR: '1' }
  })

  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

const fixture = () => {
  const root = project({
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'src/invalid.js': 'debugger\n',
    'company.mjs': "export default { locked: ['no-debugger'] }\n",
    'pawl.config.mjs': "export default { extends: './company.mjs', rules: { 'no-debugger': 'off' } }\n"
  })

  link(root)

  return root
}

const initArgs = ['init', '--yes', '--no-install', '--no-editor']

describe('adoption without recording a baseline', { timeout: 60_000 }, () => {
  it('keeps existing invalid source and locked rules blocking under real Biome', async () => {
    const root = fixture()
    const initialized = run(root, ...initArgs, '--no-baseline')

    expect(initialized).toMatchObject({ code: 0, stderr: '' })
    expect(initialized.stdout).toContain('No baseline will be recorded.')
    expect(existsSync(join(root, BASELINE_FILE))).toBe(false)
    expect(readFileSync(join(root, 'src/invalid.js'), 'utf8')).toBe('debugger\n')

    const result = await check({ root })

    expect(result.setup.some(issue => issue.code === 'engine-failed')).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file: 'src/invalid.js', rule: 'no-debugger', severity: 'error', engine: 'biome' })
    )
    expect(exitCode(result)).toBe(1)
    expect(result.baselined).toBe(0)
    expect(existsSync(join(root, BASELINE_FILE))).toBe(false)
  })

  it('describes the strict plan without writing configuration or a baseline', () => {
    const root = fixture()
    const before = readFileSync(join(root, 'package.json'), 'utf8')
    const result = run(root, ...initArgs, '--no-baseline', '--dry-run')

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(result.stdout).toContain('No baseline will be recorded.')
    expect(result.stdout).toContain('Dry run. Nothing was changed.')
    expect(existsSync(join(root, BASELINE_FILE))).toBe(false)
    expect(existsSync(join(root, 'biome.json'))).toBe(false)
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before)
  })

  it('honors the option through the public plan and baseline helper', async () => {
    const root = fixture()
    const plan = await planInit({ root, baseline: false, install: false, editor: false })

    expect(plan.baseline).toBe(false)
    expect(await recordBaseline(root, plan)).toBeUndefined()
    expect(existsSync(join(root, BASELINE_FILE))).toBe(false)
  })

  it('still records a baseline by default', async () => {
    const root = fixture()

    expect(run(root, ...initArgs)).toMatchObject({ code: 0, stderr: '' })
    expect(existsSync(join(root, BASELINE_FILE))).toBe(true)
    expect((await check({ root })).findings.some(finding => finding.rule === 'no-debugger')).toBe(false)
  })

  it('preserves existing baselines byte for byte and explains their continued effect', () => {
    const root = fixture()
    const baseline = '{"version":1,"findings":{"src/invalid.js":{"no-debugger":1}},"suppressions":{}}\n'

    write(root, { [BASELINE_FILE]: baseline })

    const result = run(root, ...initArgs, '--no-baseline')

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(result.stdout).toContain(`Existing ${BASELINE_FILE} is unchanged and still applies to checks.`)
    expect(readFileSync(join(root, BASELINE_FILE), 'utf8')).toBe(baseline)
  })
})
