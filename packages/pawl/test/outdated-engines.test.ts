import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { BIOME_VERSION } from '../src/engines/biome/config.ts'
import { olderThan } from '../src/utils/semver.ts'
import { PEER_RANGES } from '../src/version.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

/**
 * Install the real engine into a fixture under another version: its package.json says `version`,
 * and its bin is the real one, so whatever runs is the engine pawl is tested with.
 */
const installAs = (root: string, packageName: string, bin: string, version: string): void => {
  const real = join(PACKAGE_ROOT, 'node_modules', packageName)
  const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')) as Record<string, unknown>

  write(root, { [`node_modules/${packageName}/package.json`]: { ...manifest, version } })
  mkdirSync(dirname(join(root, 'node_modules', packageName, bin)), { recursive: true })
  symlinkSync(join(real, bin), join(root, 'node_modules', packageName, bin))
}

const biomeProject = (version: string): string => {
  const root = project({
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'biome.json': { extends: ['@santi020k/pawl/biome'] },
    'src/a.js': 'export const a = 1\n'
  })

  link(root)
  installAs(root, '@biomejs/biome', 'bin/biome', version)

  return root
}

const eslintProject = (version: string, policy: object = { engine: 'eslint', formatter: 'prettier' }): string => {
  const root = project({
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'pawl.config.json': policy,
    '.prettierrc.json': '{}\n',
    'biome.json': { extends: ['@santi020k/pawl/biome'] },
    'eslint.config.js': "export default [{ rules: { 'no-debugger': 'error' } }]\n",
    'src/a.js': 'debugger\n'
  })

  link(root, { prettier: true })
  installAs(root, 'eslint', 'bin/eslint.js', version)

  return root
}

const engineFailures = (result: Awaited<ReturnType<typeof check>>) =>
  result.setup.filter(issue => issue.code === 'engine-failed')

describe('an engine older than pawl works with', { timeout: 60_000 }, () => {
  it('is one setup problem with both versions and "pawl upgrade", and Biome does not run', async () => {
    const result = await check({ root: biomeProject('2.5.0') })

    expect(engineFailures(result)).toEqual([
      {
        code: 'engine-failed',
        message: `Biome did not run: @biomejs/biome 2.5.0 is installed, older than the versions this pawl works with (${BIOME_VERSION}).`,
        fix: 'Run "pawl upgrade" to install a version pawl works with.'
      }
    ])
    expect(result.commands).toEqual([])
    expect(result.findings.filter(finding => finding.engine === 'biome')).toEqual([])
    expect(exitCode(result)).toBe(2)
  })

  it('is one setup problem for ESLint too, before pawl asks it which formatter owns the imports', async () => {
    for (const policy of [{ engine: 'eslint', formatter: 'prettier' }, {}]) {
      const result = await check({ root: eslintProject('9.30.0', policy) })

      expect(engineFailures(result)).toEqual([
        {
          code: 'engine-failed',
          message: `ESLint did not run: eslint 9.30.0 is installed, older than the versions this pawl works with (${PEER_RANGES.eslint}).`,
          fix: 'Run "pawl upgrade" to install a version pawl works with.'
        }
      ])
      expect(result.commands.some(command => command.startsWith('eslint'))).toBe(false)
      expect(exitCode(result)).toBe(2)
    }
  })

  it('prints one short problem in every format, not the engine errors', () => {
    const root = biomeProject('2.5.0')

    for (const format of ['pretty', 'agent', 'json', 'editor', 'github', 'sarif']) {
      const run = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), 'check', '--format', format], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0' }
      })

      expect(run.status).toBe(2)
      expect(run.stdout).toContain('pawl upgrade')
      expect(run.stdout.length).toBeLessThan(4000)
    }
  })

  it('leaves a newer one, and the one pawl pins, to run', async () => {
    for (const version of ['2.99.0', BIOME_VERSION]) {
      const result = await check({ root: biomeProject(version) })

      expect(engineFailures(result)).toEqual([])
      expect(result.commands.some(command => command.startsWith('biome check'))).toBe(true)
    }

    const eslint = await check({ root: eslintProject('99.0.0') })

    expect(engineFailures(eslint)).toEqual([])
    expect(eslint.findings.map(finding => finding.rule)).toContain('no-debugger')
  })
})

describe('olderThan', () => {
  it('is true only below every version a range allows', () => {
    expect(olderThan('2.5.0', '2.6.8')).toBe(true)
    expect(olderThan('2.6.8', '2.6.8')).toBe(false)
    expect(olderThan('2.6.9', '2.6.8')).toBe(false)
    expect(olderThan('9.30.0', '>=9.35.0')).toBe(true)
    expect(olderThan('10.0.0', '>=9.35.0')).toBe(false)
    expect(olderThan('1.94.0', '>1.94.0')).toBe(true)
    expect(olderThan('1.9.0', '^2.1.0')).toBe(true)
    expect(olderThan('3.0.0', '^2.1.0')).toBe(false)
    expect(olderThan('1.0.0', '^2.0.0 || ^1.2.0')).toBe(true)
    expect(olderThan('1.5.0', '^2.0.0 || ^1.2.0')).toBe(false)
    expect(olderThan('0.1.0', '*')).toBe(false)
    expect(olderThan('1.0.0', '<2.0.0')).toBe(false)
    expect(olderThan('1.0.0', 'not a range')).toBe(false)
    expect(olderThan('not a version', '>=1.0.0')).toBe(false)
  })
})
