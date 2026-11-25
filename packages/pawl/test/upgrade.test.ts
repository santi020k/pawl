import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BIOME_VERSION } from '../src/engines/biome/config.ts'
import { planUpgrade, upgradeSpec } from '../src/setup/upgrade.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

/** A project with ESLint and one pack plugin older than pawl works with. */
const outdated = (lockfile: Record<string, string> = { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }): string => {
  const root = project({
    ...lockfile,
    'package.json': {
      name: 'app',
      type: 'module',
      devDependencies: { eslint: '8.57.0', 'eslint-plugin-promise': '6.0.0' }
    },
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

  it('installs a pinned version with --save-exact under npm, which writes ^ before the version it is given', async () => {
    const plan = await planUpgrade(withOldBiome({ 'package-lock.json': '{}\n' }))

    expect(plan.install).toBe(
      `npm install -D --save-exact @biomejs/biome@${BIOME_VERSION} && npm install -D eslint@latest eslint-plugin-promise@latest`
    )
    // pnpm, Yarn and Bun keep an exact version exact as they are given it.
    expect((await planUpgrade(withOldBiome({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }))).install).toBe(
      `pnpm add -D @biomejs/biome@${BIOME_VERSION} eslint@latest eslint-plugin-promise@latest`
    )
  })

  it('adds to the root of a Yarn 1 workspace with -W, and to one of Yarn 2 and later without it', async () => {
    const workspace = (files: Record<string, string | object>, packageManager?: string): string =>
      withOldBiome({
        'package.json': {
          name: 'app',
          private: true,
          type: 'module',
          workspaces: ['packages/*'],
          ...(packageManager ? { packageManager } : {})
        },
        'packages/web/package.json': { name: 'web' },
        ...files
      })
    const flag = async (root: string): Promise<boolean> =>
      (await planUpgrade(root)).install?.startsWith('yarn add -D -W ') ?? false

    expect(await flag(workspace({ 'yarn.lock': '# yarn lockfile v1\n' }))).toBe(true)
    expect(await flag(workspace({}, 'yarn@1.22.22'))).toBe(true)
    expect(await flag(workspace({}, 'yarn@4.19.0'))).toBe(false)
    expect(await flag(workspace({ 'yarn.lock': '__metadata:\n  version: 8\n', '.yarnrc.yml': '' }))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'runs both installs in turn, and stops without syncing when one fails',
    async () => {
      const bin = project({
        npm: `#!/bin/sh\necho "npm $*" >> "$NPM_LOG"\nif echo "$*" | grep -q -- "$NPM_FAIL"; then exit 1; fi\n`
      })

      chmodSync(join(bin, 'npm'), 0o755)

      const upgrade = (root: string, fail: string) =>
        spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), 'upgrade'], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
            NPM_LOG: join(root, 'npm.log'),
            NPM_FAIL: fail,
            CI: '',
            GITHUB_ACTIONS: '',
            NO_COLOR: '1',
            PAWL_AGENT: '0'
          }
        })
      const done = withOldBiome({ 'package-lock.json': '{}\n' })

      expect(upgrade(done, 'never').status).toBe(0)
      expect(existsSync(join(done, 'biome.json'))).toBe(true)
      expect(readFileSync(join(done, 'npm.log'), 'utf8').trim().split('\n')).toEqual([
        `npm install -D --save-exact @biomejs/biome@${BIOME_VERSION}`,
        'npm install -D eslint@latest eslint-plugin-promise@latest'
      ])

      const failed = withOldBiome({ 'package-lock.json': '{}\n' })
      const result = upgrade(failed, '--save-exact')

      expect(result.status).toBe(2)
      expect(result.stdout).toContain('Could not install automatically. Run this yourself:')
      expect(readFileSync(join(failed, 'npm.log'), 'utf8').trim().split('\n')).toHaveLength(1)
      // The sync waits for the new versions, so it does not run after a failed install.
      expect(existsSync(join(failed, 'biome.json'))).toBe(false)
    }
  )
})

/** The outdated project with Biome at a version other than the one pawl pins, and the files given. */
const withOldBiome = (files: Record<string, string | object>): string => {
  const root = outdated({})

  write(root, {
    'node_modules/@biomejs/biome/package.json': {
      name: '@biomejs/biome',
      version: '2.0.0',
      bin: { biome: 'bin/biome' }
    },
    'node_modules/@biomejs/biome/bin/biome': '\n',
    ...files
  })

  return root
}
