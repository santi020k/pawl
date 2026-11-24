import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planUpgrade, upgradeSpec } from '../src/setup/upgrade.ts'
import { link, PACKAGE_ROOT, project } from './helpers.ts'

/** A project with ESLint and one pack plugin older than pawl works with. */
const outdated = (): string => {
  const root = project({
    'package.json': {
      name: 'app',
      type: 'module',
      devDependencies: { eslint: '8.57.0', 'eslint-plugin-promise': '6.0.0' }
    },
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'pawl.config.json': { engine: 'eslint', packs: ['promise'] },
    'node_modules/eslint/package.json': {
      name: 'eslint',
      version: '8.57.0',
      main: 'index.js',
      bin: { eslint: 'bin.js' }
    },
    'node_modules/eslint/index.js': 'module.exports = {}\n',
    'node_modules/eslint/bin.js': '\n',
    'node_modules/eslint-plugin-promise/package.json': {
      name: 'eslint-plugin-promise',
      version: '6.0.0',
      main: 'index.js'
    },
    'node_modules/eslint-plugin-promise/index.js': 'module.exports = { rules: {}, configs: {} }\n'
  })

  link(root)

  return root
}

describe('pawl upgrade', () => {
  it('installs the tools that are out of range, the pinned ones exactly and the rest at their newest', async () => {
    const plan = await planUpgrade(outdated())

    expect(plan.upgrades).toEqual([
      expect.objectContaining({ name: 'eslint', installed: '8.57.0', spec: 'eslint@latest' }),
      expect.objectContaining({
        name: 'eslint-plugin-promise',
        installed: '6.0.0',
        spec: 'eslint-plugin-promise@latest'
      })
    ])
    expect(plan.install).toBe('pnpm add -D eslint@latest eslint-plugin-promise@latest')
  })

  it('pins Biome and Oxlint exactly, as pawl reads what those versions report', () => {
    expect(upgradeSpec('@biomejs/biome')).toMatch(/^@biomejs\/biome@\d+\.\d+\.\d+$/)
    expect(upgradeSpec('oxlint')).toMatch(/^oxlint@\d+\.\d+\.\d+$/)
    expect(upgradeSpec('prettier')).toBe('prettier@latest')
  })

  it('has nothing to install when every tool is in range, and leaves tools that are not installed to add', async () => {
    const root = project({ 'package.json': { name: 'app' }, 'pawl.config.json': { engine: 'eslint' } })

    link(root)

    const plan = await planUpgrade(root)

    expect(plan.upgrades.filter(upgrade => upgrade.name !== '@biomejs/biome')).toEqual([])
  })

  it('shows the plan and changes nothing with --dry-run', () => {
    const root = outdated()
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), 'upgrade', '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0' }
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('eslint 8.57.0 is outside >=')
    expect(result.stdout).toContain('Run    pnpm add -D eslint@latest eslint-plugin-promise@latest')
    expect(result.stdout).toContain('Dry run. Nothing was changed.')
  })
})
