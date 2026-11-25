import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkRoot } from '../src/cli/commands/check.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

/** A React app and a Vue app side by side, as in a monorepo. */
const mixed = (extra: Record<string, string | object> = {}): string =>
  project({
    'package.json': { name: 'repo', private: true, type: 'module', workspaces: ['apps/*'] },
    'apps/web/package.json': { name: 'web', dependencies: { react: '^19.0.0' } },
    'apps/admin/package.json': { name: 'admin', dependencies: { vue: '^3.5.0' } },
    ...extra
  })

describe('a check started in a package folder', { timeout: 60_000 }, () => {
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0' }
    })

  /** A Biome monorepo in git, set up at the root as `pawl init` leaves it, with a finding in each package. */
  const repo = (): string => {
    const root = mixed({
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      'apps/web/src/a.js': 'debugger\n',
      'apps/admin/src/a.js': 'debugger\n'
    })

    link(root)
    spawnSync('git', ['init', '-q'], { cwd: root })

    return root
  }

  it('checks from the root of the repo, as at the root, and takes files from the folder it started in', () => {
    const root = repo()
    const web = join(root, 'apps/web')
    const whole = run(web, 'check', '--format', 'agent')

    expect(whole.status).toBe(1)
    expect(whole.stdout).not.toContain('No biome.json found')
    expect(whole.stdout).toContain('"file":"apps/web/src/a.js"')
    expect(whole.stdout).toContain('"file":"apps/admin/src/a.js"')

    const named = run(web, 'check', 'src/a.js', '--format', 'agent')

    expect(named.status).toBe(1)
    expect(named.stdout).toContain('"file":"apps/web/src/a.js"')
    expect(named.stdout).not.toContain('apps/admin')
  })

  it('records the baseline at the root', () => {
    const root = repo()

    expect(run(join(root, 'apps/web'), 'baseline').status).toBe(0)
    expect(existsSync(join(root, '.pawl/baseline.json'))).toBe(true)
    expect(existsSync(join(root, 'apps/web/.pawl'))).toBe(false)
    expect(run(join(root, 'apps/admin'), 'check').status).toBe(0)
  })

  it('stays in a package with its own setup, and does not leave the repository', () => {
    const root = repo()

    write(root, { 'apps/web/biome.json': { extends: ['@santi020k/pawl/biome'] } })
    expect(checkRoot(join(root, 'apps/web'))).toBe(join(root, 'apps/web'))
    expect(checkRoot(join(root, 'apps/admin/src'))).toBe(root)

    // A repository in a folder pawl was set up in stops the search at its own top.
    const inner = join(root, 'vendor/lib')

    write(root, { 'vendor/lib/package.json': { name: 'lib' } })
    spawnSync('git', ['init', '-q'], { cwd: inner })
    expect(checkRoot(inner)).toBe(inner)
  })
})
