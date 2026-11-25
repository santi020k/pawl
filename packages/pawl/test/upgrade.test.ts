import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPack } from '../src/catalog/packs.ts'
import { BIOME_VERSION } from '../src/engines/biome/config.ts'
import { PLUGIN_PEERS } from '../src/setup/install.ts'
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
  it('moves a tool older than the major version of its floor to that major version, and says so', async () => {
    const plan = await planUpgrade(outdated())

    expect(plan.upgrades).toEqual([
      expect.objectContaining({ name: 'eslint', installed: '8.57.0', spec: 'eslint@9', major: true }),
      expect.objectContaining({
        name: 'eslint-plugin-promise',
        installed: '6.0.0',
        spec: 'eslint-plugin-promise@7',
        major: true
      })
    ])
    expect(plan.install).toBe('pnpm add -D eslint@9 eslint-plugin-promise@7')
    expect(plan.notes).toContain(
      'No eslint 8.x is in >=9.35.0, so it moves to 9, a new major version. Read its release notes before you commit the upgrade.'
    )
  })

  it('keeps a tool on its major version when a newer version of it is in range', async () => {
    const root = outdated()

    write(root, {
      'node_modules/eslint/package.json': {
        name: 'eslint',
        version: '9.30.0',
        main: 'index.js',
        bin: { eslint: 'bin.js' }
      }
    })

    const plan = await planUpgrade(root)

    expect(plan.upgrades[0]).toMatchObject({ name: 'eslint', installed: '9.30.0', spec: 'eslint@9', major: false })
    expect(plan.notes.join(' ')).not.toContain('No eslint 9.x')
  })

  it('installs the newest version of the release line the floor is in, as ^ reads a line', () => {
    expect(upgradeSpec('eslint', '9.30.0', '>=9.35.0')).toEqual({ spec: 'eslint@9', major: false })
    expect(upgradeSpec('eslint', '8.57.0', '>=9.35.0')).toEqual({ spec: 'eslint@9', major: true })
    // A prerelease above the floor is out of range, and the release of its own line is in it.
    expect(upgradeSpec('eslint', '10.0.0-rc.2', '>=9.35.0')).toEqual({ spec: 'eslint@10', major: false })
    // Below 1.0.0, the minor is the line.
    expect(upgradeSpec('eslint-plugin-solid', '0.14.0', '>=0.14.1')).toEqual({
      spec: 'eslint-plugin-solid@0.14',
      major: false
    })
    expect(upgradeSpec('eslint-plugin-solid', '0.13.2', '>=0.14.1')).toEqual({
      spec: 'eslint-plugin-solid@0.14',
      major: true
    })
    expect(upgradeSpec('prettier', '2.8.8', '>=3.0.0')).toEqual({ spec: 'prettier@3', major: true })
  })

  it('pins Biome and Oxlint exactly, as pawl reads what those versions report', () => {
    expect(upgradeSpec('@biomejs/biome', '2.0.0', BIOME_VERSION)).toEqual({
      spec: `@biomejs/biome@${BIOME_VERSION}`,
      major: false
    })
    expect(upgradeSpec('@biomejs/biome', '1.9.4', BIOME_VERSION).major).toBe(true)
    expect(upgradeSpec('oxlint', '1.0.0', '>=1.94.0').spec).toMatch(/^oxlint@\d+\.\d+\.\d+$/)
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
    expect(result.stdout).toContain('eslint 8.57.0 is outside >=9.35.0: installing eslint@9, a new major version')
    expect(result.stdout).toContain('Run    pnpm add -D eslint@9 eslint-plugin-promise@7')
    expect(result.stdout).toContain('Dry run. Nothing was changed.')
  })

  it('installs a pinned version with --save-exact under npm, which writes ^ before the version it is given', async () => {
    const plan = await planUpgrade(withOldBiome({ 'package-lock.json': '{}\n' }))

    expect(plan.install).toBe(
      `npm install -D --save-exact @biomejs/biome@${BIOME_VERSION} && npm install -D eslint@9 eslint-plugin-promise@7`
    )
    // pnpm, Yarn and Bun keep an exact version exact as they are given it.
    expect((await planUpgrade(withOldBiome({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }))).install).toBe(
      `pnpm add -D @biomejs/biome@${BIOME_VERSION} eslint@9 eslint-plugin-promise@7`
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

  it('installs a tool into the workspace packages that declare it, not into the root it is hoisted to', async () => {
    const workspace = (files: Record<string, string>): string => {
      const root = outdated(files)

      write(root, {
        'package.json': {
          name: 'app',
          private: true,
          type: 'module',
          workspaces: ['packages/*'],
          devDependencies: { 'eslint-plugin-promise': '6.0.0' }
        },
        'packages/web/package.json': { name: '@app/web', devDependencies: { eslint: '8.57.0' } },
        'packages/config/package.json': { name: '@app/config', dependencies: { eslint: '8.57.0' } },
        'packages/docs/package.json': { name: '@app/docs' }
      })

      return root
    }
    const npm = await planUpgrade(workspace({ 'package-lock.json': '{}\n' }))

    expect(npm.upgrades[0]).toMatchObject({ name: 'eslint', where: ['packages/config', 'packages/web'] })
    // A package that lists the tool in its dependencies keeps it there.
    expect(npm.install).toBe(
      'npm install -w @app/config eslint@9 && npm install -D -w @app/web eslint@9 && npm install -D eslint-plugin-promise@7'
    )
    expect((await planUpgrade(workspace({ 'yarn.lock': '# yarn lockfile v1\n' }))).install).toBe(
      'yarn workspace @app/config add eslint@9 && yarn workspace @app/web add -D eslint@9 && yarn add -D -W eslint-plugin-promise@7'
    )
    expect((await planUpgrade(workspace({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }))).install).toBe(
      'pnpm add --filter @app/config eslint@9 && pnpm add -D --filter @app/web eslint@9 && pnpm add -D -w eslint-plugin-promise@7'
    )
    expect((await planUpgrade(workspace({ 'bun.lock': '{}\n' }))).install).toBe(
      'bun add --cwd packages/config eslint@9 && bun add -d --cwd packages/web eslint@9 && bun add -d eslint-plugin-promise@7'
    )

    const unnamed = workspace({ 'package-lock.json': '{}\n' })

    write(unnamed, { 'packages/web/package.json': { devDependencies: { eslint: '8.57.0' } } })

    const plan = await planUpgrade(unnamed)

    expect(plan.install).toBe('npm install -w @app/config eslint@9 && npm install -D eslint-plugin-promise@7')
    expect(plan.notes).toContain(
      'packages/web declares eslint 8.57.0 and has no package name pawl can put in a command, so pawl cannot install into it. Install eslint@9 in packages/web yourself.'
    )

    // A name npm would refuse never reaches the command, which runs in a shell on Windows.
    write(unnamed, { 'packages/web/package.json': { name: 'web&calc', devDependencies: { eslint: '8.57.0' } } })
    expect((await planUpgrade(unnamed)).install).toBe(
      'npm install -w @app/config eslint@9 && npm install -D eslint-plugin-promise@7'
    )
    write(unnamed, { 'packages/web/package.json': { name: '-web', devDependencies: { eslint: '8.57.0' } } })
    expect((await planUpgrade(unnamed)).install).toBe(
      'npm install -w @app/config eslint@9 && npm install -D eslint-plugin-promise@7'
    )
    // A legacy name with capitals is one the package managers still take.
    write(unnamed, { 'packages/web/package.json': { name: 'MyWeb', devDependencies: { eslint: '8.57.0' } } })
    expect((await planUpgrade(unnamed)).install).toBe(
      'npm install -w @app/config eslint@9 && npm install -D -w MyWeb eslint@9 && npm install -D eslint-plugin-promise@7'
    )

    // Under Bun the folder goes in the command, so only a plain path does.
    const bun = workspace({ 'bun.lock': '{}\n' })

    write(bun, {
      'package.json': {
        name: 'app',
        private: true,
        type: 'module',
        workspaces: ['packages/*'],
        devDependencies: { 'eslint-plugin-promise': '6.0.0' }
      },
      'packages/a&b/package.json': { name: 'ab', devDependencies: { eslint: '8.57.0' } }
    })
    expect((await planUpgrade(bun)).install).not.toContain('a&b')
  })

  it('leaves a workspace package whose own ESLint is one pawl works with, and moves each other by its own version', async () => {
    const root = outdated()
    const eslint = (version: string): object => ({
      name: 'eslint',
      version,
      main: 'index.js',
      bin: { eslint: 'bin.js' }
    })

    write(root, {
      'package.json': {
        name: 'app',
        private: true,
        type: 'module',
        workspaces: ['packages/*'],
        devDependencies: { eslint: '8.57.0', 'eslint-plugin-promise': '6.0.0' }
      },
      'packages/web/package.json': { name: '@app/web', devDependencies: { eslint: '^10.0.0' } },
      'packages/web/node_modules/eslint/package.json': eslint('10.0.0'),
      'packages/old/package.json': { name: '@app/old', devDependencies: { eslint: '^9.0.0' } },
      'packages/old/node_modules/eslint/package.json': eslint('9.30.0'),
      // Asks for a version pawl works with, and has an older copy of its own: the copy decides.
      'packages/stale/package.json': { name: '@app/stale', devDependencies: { eslint: '^9.35.0' } },
      'packages/stale/node_modules/eslint/package.json': eslint('9.30.0'),
      // Declares a range pawl works with, and resolves the copy hoisted to the root.
      'packages/hoisted/package.json': { name: '@app/hoisted', devDependencies: { eslint: '^10.0.0' } }
    })

    const plan = await planUpgrade(root)

    expect(plan.upgrades.filter(upgrade => upgrade.name === 'eslint')).toEqual([
      expect.objectContaining({ installed: '8.57.0', spec: 'eslint@9', major: true, where: [''] }),
      expect.objectContaining({
        installed: '9.30.0',
        spec: 'eslint@9',
        major: false,
        where: ['packages/old', 'packages/stale']
      })
    ])
    expect(plan.install).toBe(
      'pnpm add -D -w eslint@9 eslint-plugin-promise@7 && pnpm add -D --filter @app/old eslint@9 && pnpm add -D --filter @app/stale eslint@9'
    )
    expect(plan.install).not.toContain('@app/web')
    expect(plan.install).not.toContain('@app/hoisted')
  })

  it('moves a workspace package on an older copy of a tool when the root has one pawl works with', async () => {
    const root = outdated()
    const eslint = (version: string): object => ({
      name: 'eslint',
      version,
      main: 'index.js',
      bin: { eslint: 'bin.js' }
    })

    write(root, {
      'package.json': {
        name: 'app',
        private: true,
        type: 'module',
        workspaces: ['packages/*'],
        devDependencies: { eslint: '9.35.0', 'eslint-plugin-promise': '6.0.0' }
      },
      'node_modules/eslint/package.json': eslint('9.35.0'),
      'packages/web/package.json': { name: '@app/web', devDependencies: { eslint: '8.57.0' } },
      'packages/web/node_modules/eslint/package.json': eslint('8.57.0')
    })

    const plan = await planUpgrade(root)

    expect(plan.upgrades.filter(upgrade => upgrade.name === 'eslint')).toEqual([
      expect.objectContaining({ installed: '8.57.0', spec: 'eslint@9', major: true, where: ['packages/web'] })
    ])
    expect(plan.install).toBe('pnpm add -D --filter @app/web eslint@9 && pnpm add -D -w eslint-plugin-promise@7')
  })

  it('installs the vue-eslint-parser that eslint-plugin-vue 10 takes as a peer, first and on its own under npm', async () => {
    const vue = (lockfile: Record<string, string>): string => {
      const root = outdated(lockfile)

      write(root, {
        'package.json': {
          name: 'app',
          type: 'module',
          dependencies: { vue: '^3.5.0' },
          devDependencies: { eslint: '8.57.0', 'eslint-plugin-vue': '9.33.0' }
        },
        'pawl.config.json': { engine: 'eslint', packs: ['vue'] },
        'node_modules/eslint-plugin-vue/package.json': {
          name: 'eslint-plugin-vue',
          version: '9.33.0',
          main: 'index.js'
        },
        'node_modules/eslint-plugin-vue/index.js': 'module.exports = { rules: {}, configs: {} }\n'
      })

      return root
    }

    // npm cannot swap the plugin and the parser its old version brought in one install: ERESOLVE.
    expect((await planUpgrade(vue({ 'package-lock.json': '{}\n' }))).install).toBe(
      'npm install -D vue-eslint-parser@10 && npm install -D eslint@9 eslint-plugin-vue@10'
    )
    // Yarn 1 installs no peers, so the plugin needs the parser in the command too.
    expect((await planUpgrade(vue({ 'yarn.lock': '# yarn lockfile v1\n' }))).install).toBe(
      'yarn add -D vue-eslint-parser@10 eslint@9 eslint-plugin-vue@10'
    )
  })

  it('takes the parser on the line of the Vue plugin it installs', () => {
    // eslint-plugin-vue 10 takes vue-eslint-parser 10. A new floor for the plugin needs its peer looked at again.
    expect(getPack('vue')?.range).toBe('>=10.0.0')
    expect(PLUGIN_PEERS['eslint-plugin-vue']).toEqual(['vue-eslint-parser@10'])
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
        'npm install -D eslint@9 eslint-plugin-promise@7'
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
