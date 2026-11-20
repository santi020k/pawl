import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { WALK_SKIP } from './ignores.ts'

/** Turn "one, many or none" into a list. */
export const toList = <T>(value: T | readonly T[] | undefined): T[] => {
  if (value === undefined) return []

  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T]
}

/** The directories from `start` up to the filesystem root, nearest first. */
export const ancestors = (start: string): string[] => {
  const dirs = [resolve(start)]

  while (dirname(dirs.at(-1) as string) !== dirs.at(-1)) dirs.push(dirname(dirs.at(-1) as string))

  return dirs
}

export const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'))

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

export const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export const readJson = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

/** Parse JSON that may hold comments or trailing commas, as editor settings files often do. */
export const readJsonc = <T>(file: string): { value: T | undefined; hasComments: boolean } => {
  let text: string

  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { value: undefined, hasComments: false }
  }

  const stripped = stripJsonComments(text)

  try {
    return { value: JSON.parse(stripped.replace(/,(\s*[}\]])/g, '$1')) as T, hasComments: stripped !== text }
  } catch {
    return { value: undefined, hasComments: stripped !== text }
  }
}

const stripJsonComments = (text: string): string => {
  let out = ''
  let inString = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string
    const next = text[index + 1]

    if (inString) {
      out += char

      if (char === '\\') out += text[++index] ?? ''
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index++

      out += '\n'
    } else if (char === '/' && next === '*') {
      index = text.indexOf('*/', index + 2)

      if (index === -1) break

      index++
    } else {
      out += char
    }
  }

  return out
}

export const writeJson = (file: string, value: unknown): void => writeText(file, `${JSON.stringify(value, null, 2)}\n`)

export const writeText = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

export const isGitRepo = (root: string): boolean => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'pipe' })

    return true
  } catch {
    return false
  }
}

const git = (root: string, args: string[]): string[] =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\n')
    .filter(Boolean)

/**
 * Files changed against HEAD, plus untracked ones. In a repository with no commit yet,
 * that is every file. Empty outside a git repository.
 */
export const changedFiles = (root: string): string[] => {
  let files: string[]

  try {
    files = [
      ...git(root, ['diff', '--name-only', '--diff-filter=d', 'HEAD', '--relative']),
      ...git(root, ['ls-files', '--others', '--exclude-standard'])
    ]
  } catch {
    try {
      files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard'])
    } catch {
      return []
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
      ...git(root, ['diff', '--name-only', '--diff-filter=d', '--relative', base]),
      ...git(root, ['ls-files', '--others', '--exclude-standard'])
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
    return git(root, ['ls-files', '--cached', '--others', '--exclude-standard']).filter(file =>
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
