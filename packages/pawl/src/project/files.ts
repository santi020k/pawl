/**
 * Which files a project has, and which ones changed. Git answers where there is a repository;
 * elsewhere a directory walk does.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { toPosix } from '../utils/fs.ts'
import { WALK_SKIP } from './ignores.ts'

const realpath = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * A path a caller names, as pawl keeps every path: relative to the root, with forward slashes and
 * no leading "./". The root itself is ".". Undefined for a path outside the root, which is not
 * part of the project. A path may be absolute, as hook runners such as lint-staged pass them.
 */
export const projectPath = (root: string, file: string): string | undefined => {
  const inside = (path: string): string | undefined =>
    path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path) ? undefined : toPosix(path) || '.'
  const absolute = resolve(root, file)

  // A link in either path, such as /tmp on macOS, must not put a project file outside the project.
  return inside(relative(root, absolute)) ?? inside(relative(realpath(root), realpath(absolute)))
}

export const isGitRepo = (root: string): boolean => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'pipe' })

    return true
  } catch {
    return false
  }
}

const gitOutput = (root: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024
  })

const git = (root: string, args: string[]): string[] => gitOutput(root, args).split('\n').filter(Boolean)

/**
 * A git command that lists files. Read with `-z`, so each name comes as it is on disk: without it
 * git quotes and escapes any name with a character outside ASCII, and that file would never be found.
 */
const gitFiles = (root: string, [command, ...args]: [string, ...string[]]): string[] =>
  gitOutput(root, [command, '-z', ...args])
    .split('\0')
    .filter(Boolean)

/**
 * Files changed against HEAD, plus untracked ones. In a repository with no commit yet,
 * that is every file. Undefined outside a git repository, where nothing can say what changed:
 * the caller then looks at every file, because an empty list would pass a check without running it.
 */
export const changedFiles = (root: string): string[] | undefined => {
  let files: string[]

  try {
    files = [
      ...gitFiles(root, ['diff', '--name-only', '--diff-filter=d', 'HEAD', '--relative']),
      ...gitFiles(root, ['ls-files', '--others', '--exclude-standard'])
    ]
  } catch {
    try {
      files = gitFiles(root, ['ls-files', '--cached', '--others', '--exclude-standard'])
    } catch {
      return undefined
    }
  }

  return [...new Set(files)].filter(file => existsSync(join(root, file)))
}

/** Why `changedSince` could not tell which files changed. */
export class SinceError extends Error {
  readonly fix: string

  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

/**
 * Files changed since the current branch left `ref`: the commits on the branch,
 * what is not committed yet, and untracked files. Throws a `SinceError` when git
 * cannot answer, because an empty list would pass the check without running it.
 */
export const changedSince = (root: string, ref: string): string[] => {
  if (!isGitRepo(root))
    throw new SinceError(`--since ${ref} needs a git repository.`, 'Run the check inside the repository.')

  let commit: string | undefined

  try {
    ;[commit] = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])
  } catch {
    commit = undefined
  }

  if (!commit)
    throw new SinceError(
      `--since: git does not know "${ref}".`,
      'Fetch it first. In GitHub Actions, set "fetch-depth: 0" on actions/checkout.'
    )

  let base: string | undefined

  try {
    ;[base] = git(root, ['merge-base', commit, 'HEAD'])
  } catch {
    base = undefined
  }

  if (!base)
    throw new SinceError(
      `--since: "${ref}" and HEAD share no commit in this clone.`,
      'Fetch the full history. In GitHub Actions, set "fetch-depth: 0" on actions/checkout.'
    )

  let files: string[] | undefined

  try {
    files = [
      ...gitFiles(root, ['diff', '--name-only', '--diff-filter=d', '--relative', base]),
      ...gitFiles(root, ['ls-files', '--others', '--exclude-standard'])
    ]
  } catch {
    files = undefined
  }

  if (!files)
    throw new SinceError(
      `--since: git could not list the files changed since "${ref}".`,
      'Run "git status" to see what is wrong with the repository.'
    )

  return [...new Set(files)].filter(file => existsSync(join(root, file)))
}

/** Every project file: what git tracks or would track, else a directory walk. */
export const listFiles = (root: string): string[] => {
  try {
    return gitFiles(root, ['ls-files', '--cached', '--others', '--exclude-standard']).filter(file =>
      existsSync(join(root, file))
    )
  } catch {
    return walk(root, root)
  }
}

const walk = (root: string, dir: string): string[] => {
  const files: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!WALK_SKIP.has(entry.name)) files.push(...walk(root, join(dir, entry.name)))
    } else if (entry.isFile()) {
      files.push(toPosix(relative(root, join(dir, entry.name))))
    }
  }

  return files
}
