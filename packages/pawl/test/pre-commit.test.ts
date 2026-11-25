import { spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedFiles } from '../src/project/files.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const git = (root: string, ...args: string[]): void => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root })

  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr)}`)
}

const commit = (root: string, message: string): void => {
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', message)
}

describe('the pre-commit hook init writes, in a real commit', { timeout: 60_000 }, () => {
  /** A repository with a committed file, and a pre-commit hook that runs pawl's check --changed. */
  const repo = (): string => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      '.gitignore': 'node_modules\n',
      'src/a.js': 'export const a = 1\n',
      'src/b.js': 'export const b = 1\n'
    })

    link(root)
    git(root, 'init', '-q', '-b', 'main')
    commit(root, 'init')
    write(root, {
      '.git/hooks/pre-commit': `#!/bin/sh\nexec "${process.execPath}" "${join(PACKAGE_ROOT, 'src/cli.ts')}" check --changed\n`
    })
    chmodSync(join(root, '.git/hooks/pre-commit'), 0o755)

    return root
  }

  const commitStaged = (root: string, ...files: string[]) => {
    spawnSync('git', ['add', ...files], { cwd: root })

    return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'change'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0' }
    })
  }

  it('checks the files of the commit, and not an untracked file or a change that is not staged', () => {
    const root = repo()

    write(root, {
      'src/a.js': 'export const a = 2\n',
      'src/b.js': 'debugger\n',
      'src/untracked.js': 'debugger\n',
      'notes.json': '{"not":   "formatted"}\n'
    })

    const committed = commitStaged(root, 'src/a.js')

    // Git shows what a hook prints on stderr.
    expect(committed.stderr).toContain('No new findings.')
    expect(committed.stderr).not.toMatch(/untracked\.js|src\/b\.js|notes\.json/)
    expect(committed.status).toBe(0)

    // Outside the hook, --changed is still what changed against HEAD, untracked files too.
    expect(changedFiles(root, {})?.sort()).toEqual(['notes.json', 'src/b.js', 'src/untracked.js'])
  })

  it('still stops a commit with a finding in a file it changes', () => {
    const root = repo()

    write(root, { 'src/a.js': 'debugger\n' })

    const committed = commitStaged(root, 'src/a.js')

    expect(committed.status).not.toBe(0)
    expect(committed.stderr).toContain('src/a.js')
  })
})
