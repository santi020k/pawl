import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check, exitCode } from '../src/check/check.ts'
import { changedFiles, changedSince, listFiles, SinceError } from '../src/utils/fs.ts'
import { project, write } from './helpers.ts'

const git = (root: string, ...args: string[]): void => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root })

  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr)}`)
}

const commit = (root: string, message: string): void => {
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', message)
}

/** A repository on `feature`, one commit ahead of `main`, which has moved on since. */
const branched = (): string => {
  const root = project({ 'src/a.js': 'export const a = 1\n', 'src/gone.js': 'export const gone = 1\n' })

  git(root, 'init', '-q', '-b', 'main')
  commit(root, 'init')
  git(root, 'checkout', '-qb', 'feature')
  write(root, { 'src/b.js': 'export const b = 1\n' })
  rmSync(join(root, 'src/gone.js'))
  commit(root, 'add b, remove gone')
  git(root, 'checkout', '-q', 'main')
  write(root, { 'src/c.js': 'export const c = 1\n' })
  commit(root, 'add c')
  git(root, 'checkout', '-q', 'feature')

  return root
}

describe('changedSince', () => {
  it('lists what the branch committed, and leaves out deleted files and what the ref gained later', () => {
    expect(changedSince(branched(), 'main')).toEqual(['src/b.js'])
  })

  it('adds what is not committed yet and untracked files', () => {
    const root = branched()

    write(root, { 'src/a.js': 'export const a = 2\n', 'src/new file.js': 'export const d = 1\n' })

    expect(changedSince(root, 'main').sort()).toEqual(['src/a.js', 'src/b.js', 'src/new file.js'])
  })

  it('is empty on the ref itself', () => {
    const root = branched()

    git(root, 'checkout', '-q', 'main')

    expect(changedSince(root, 'main')).toEqual([])
  })

  it('fails for a ref git does not know', () => {
    expect(() => changedSince(branched(), 'origin/main')).toThrow(SinceError)
  })

  it('never passes the ref to git as an option', () => {
    expect(() => changedSince(branched(), '--output=owned')).toThrow('git does not know "--output=owned"')
  })

  it('fails when the ref and HEAD share no commit', () => {
    const root = branched()

    git(root, 'checkout', '-q', '--orphan', 'island')
    commit(root, 'island')

    expect(() => changedSince(root, 'main')).toThrow('share no commit')
  })

  it('fails outside a git repository', () => {
    expect(() => changedSince(project({ 'src/a.js': 'export const a = 1\n' }), 'main')).toThrow(
      'needs a git repository'
    )
  })
})

describe('file names git would quote', () => {
  // Left alone, git prints "src/na\303\257ve.js" for the second of these, quotes and all.
  const NAMES = ['docs/café menu.md', 'src/naïve.js', 'src/日本語.js']

  it('are listed as they are on disk, tracked or not', () => {
    const root = project({ 'src/a.js': 'export const a = 1\n', [NAMES[0] as string]: '# Menu\n' })

    git(root, 'init', '-q', '-b', 'main')
    commit(root, 'init')
    write(root, { [NAMES[1] as string]: 'export const b = 1\n', [NAMES[2] as string]: 'export const c = 1\n' })

    expect(listFiles(root).sort()).toEqual([...NAMES, 'src/a.js'].sort())
  })

  it('are found by --changed and --since', () => {
    const root = project({ 'src/a.js': 'export const a = 1\n', [NAMES[0] as string]: '# Menu\n' })

    git(root, 'init', '-q', '-b', 'main')
    commit(root, 'init')
    git(root, 'checkout', '-qb', 'feature')
    write(root, { [NAMES[1] as string]: 'export const b = 1\n' })
    commit(root, 'add a file')
    write(root, { [NAMES[0] as string]: '# The menu\n', [NAMES[2] as string]: 'export const c = 1\n' })

    expect(changedFiles(root)?.sort()).toEqual([NAMES[0], NAMES[2]].sort())
    expect(changedSince(root, 'main').sort()).toEqual([...NAMES].sort())
  })
})

describe('changedFiles', () => {
  it('is every file before the first commit, and undefined outside a git repository', () => {
    const root = project({ 'src/a.js': 'export const a = 1\n' })

    // Nothing can say what changed here, so the caller looks at every file.
    expect(changedFiles(root)).toBeUndefined()

    git(root, 'init', '-q', '-b', 'main')

    expect(changedFiles(root)).toEqual(['src/a.js'])
  })
})

describe('check with since', () => {
  it('reports an unknown ref as a blocking setup problem and runs nothing', async () => {
    const result = await check({ root: branched(), since: 'origin/main' })

    expect(result.setup).toContainEqual({
      code: 'since-unresolved',
      message: '--since: git does not know "origin/main".',
      fix: 'Fetch it first. In GitHub Actions, set "fetch-depth: 0" on actions/checkout.'
    })
    expect(result.commands).toEqual([])
    expect(result.findings).toEqual([])
    expect(exitCode(result)).toBe(2)
  })
})
