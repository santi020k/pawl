import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Policy } from './types.ts'

/** Never checked, whatever the policy says: dependencies, git's own folder and pawl's own files. */
export const ALWAYS_IGNORED = ['node_modules', '.git', '.pawl']

/**
 * What no project wants linted: build output, caches, lockfiles, the folders of AI coding tools,
 * and generated code. Every engine skips these unless the policy sets `defaultIgnores: false`.
 * A pattern without a slash matches at any depth, as in .gitignore.
 */
export const DEFAULT_IGNORES = [
  // Build output and caches.
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.next',
  '.open-next',
  '.astro',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.vercel',
  '.wrangler',
  'playwright-report',
  'test-results',
  '*.tsbuildinfo',
  // Lockfiles: written by the package manager, never by people.
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  // Changesets parses the front matter of these files, which a Markdown formatter would rewrite.
  '.changeset',
  // Rules and skills that AI coding tools keep for themselves.
  '.agent',
  '.agents',
  '.aider*',
  '.claude',
  '.clinerules',
  '.codex',
  '.copilot',
  '.cursor',
  '.gemini',
  '.kiro',
  '.opencode',
  '.roo',
  '.windsurf',
  // Generated code. Names people also use for code they write, such as `generated/`, are left out.
  '__generated__',
  '*.generated.*',
  '*.gen.*',
  '.prisma'
]

/** Folders a directory walk never enters, because nothing in them is checked by default. */
export const WALK_SKIP = new Set([
  ...ALWAYS_IGNORED,
  ...DEFAULT_IGNORES.filter(pattern => !/[*.]/.test(pattern.slice(1)))
])

/**
 * Turn one line of a .gitignore into pawl's glob form, or undefined for a blank line or a comment.
 * Pawl globs match at any depth when they have no slash, as .gitignore lines do; a line with a
 * slash anywhere but the end is anchored at the root, and keeps its leading slash when that is the
 * only one, so `/build` stays the folder at the root. A leading `!` re-includes what an earlier line ignored.
 */
export const fromGitignoreLine = (line: string): string | undefined => {
  const trimmed = line.replace(/(?<!\\)\s+$/, '')

  if (trimmed === '' || trimmed.startsWith('#')) return undefined

  const negated = trimmed.startsWith('!')
  const body = (negated ? trimmed.slice(1) : trimmed).replace(/^\\([#!])/, '$1')
  const withoutTrailing = body.replace(/\/+$/, '')

  if (withoutTrailing === '' || withoutTrailing === '**') return undefined

  const anchored = withoutTrailing.includes('/')
  const fromRoot = withoutTrailing.replace(/^\//, '')
  // Without its slash, a single name would match at any depth again.
  const rooted = fromRoot.includes('/') ? fromRoot : `/${fromRoot}`
  const pattern = anchored ? rooted : `**/${withoutTrailing}`

  return `${negated ? '!' : ''}${pattern}`
}

/**
 * A glob as a policy writes it, in `ignore` and in the `files` of an override, made safe for every
 * reader. There, `[` and `]` are the characters themselves, so that `app/[slug]` names that folder:
 * each one gets a backslash, which is how Biome, ESLint, Oxlint and pawl's own matcher all read a
 * literal bracket. One that already has its backslash is left alone.
 */
export const literalBrackets = (pattern: string): string => pattern.replace(/(?<!\\)[[\]]/g, '\\$&')

/** The patterns of the root .gitignore, in pawl's glob form and in their order. Empty without one. */
export const gitignorePatterns = (root: string): string[] => {
  let text: string

  try {
    text = readFileSync(join(root, '.gitignore'), 'utf8')
  } catch {
    return []
  }

  return text.split(/\r?\n/).flatMap(line => fromGitignoreLine(line) ?? [])
}

/**
 * The patterns an engine config file carries: pawl's own folder, the defaults unless turned off,
 * then the policy's own. The engines skip node_modules and .git by themselves.
 */
export const configIgnores = (policy: Pick<Policy, 'defaultIgnores' | 'ignore'>): string[] => [
  ...new Set(['.pawl', ...(policy.defaultIgnores ? DEFAULT_IGNORES : []), ...policy.ignore])
]

/**
 * Every pattern pawl skips for a project: the defaults, the root .gitignore when the policy
 * respects it, then the policy's own patterns. Order matters for the `!` lines of a .gitignore.
 */
export const allIgnores = (root: string, policy: Pick<Policy, 'defaultIgnores' | 'gitignore' | 'ignore'>): string[] => [
  ...(policy.defaultIgnores ? DEFAULT_IGNORES : []),
  ...(policy.gitignore ? gitignorePatterns(root) : []),
  ...policy.ignore
]

/**
 * A pawl glob as the engines read it: anchored at the root, with `**\/` where it matches at any depth.
 * Biome, ESLint and Oxlint would each read a bare name differently, so pawl never hands them one.
 */
export const toEngineGlob = (pattern: string): string => {
  const negated = pattern.startsWith('!')
  const body = negated ? pattern.slice(1) : pattern
  const anchored = body.includes('/') ? body.replace(/^\.?\//, '') : `**/${body}`

  return `${negated ? '!' : ''}${anchored}`
}

/**
 * ESLint's form of a pawl glob. A pattern names a file or a folder, so it is given both ways.
 * `{` and `(` are literal in a glob of pawl's but special to ESLint, so they are escaped.
 */
export const toEslintIgnores = (pattern: string): string[] => {
  const glob = toEngineGlob(pattern).replace(/(?<!\\)([{(])/g, '\\$1')

  return glob.endsWith('/**') ? [glob] : [glob, `${glob}/**`]
}

/** Biome's form of a pawl glob in `files.includes`. Biome ignores a folder by its name alone. */
export const toBiomeIgnore = (pattern: string): string => {
  const glob = toEngineGlob(pattern).replace(/\/\*\*$/, '')

  return glob.startsWith('!') ? glob.slice(1) : `!${glob}`
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\/-]/g

const literal = (text: string): string => text.replace(REGEXP_SPECIAL, '\\$&')

/** Where the character class that opens at `open` closes, or -1 when the `[` is on its own. */
const classEnd = (pattern: string, open: number): number => {
  let index = open + 1

  if (pattern[index] === '!' || pattern[index] === '^') index++

  // A `]` right after the opening is one of the characters, not the end.
  if (pattern[index] === ']') index++

  for (; index < pattern.length; index++) {
    if (pattern[index] === '\\') index++
    else if (pattern[index] === ']') return index
  }

  return -1
}

/** A character class of a .gitignore line, such as `[cod]`, `[a-z]` or `[!_]`. It never matches a slash. */
const classSource = (body: string): string => {
  const negated = body.startsWith('!') || body.startsWith('^')
  let source = ''

  for (let index = negated ? 1 : 0; index < body.length; index++) {
    const char = body[index] as string

    if (char === '\\' && index + 1 < body.length) source += literal(body[++index] as string)
    else source += char === '-' ? '-' : literal(char)
  }

  return `(?!/)[${negated ? '^' : ''}${source}]`
}

/**
 * A small glob matcher: `**`, `*`, `?`, a character class in brackets, and a backslash to take the
 * next character as it is. A pattern without a slash matches at any depth.
 */
const globToRegExp = (pattern: string): RegExp => {
  const anchored = pattern.includes('/') ? pattern.replace(/^\.?\//, '') : `**/${pattern}`
  let source = ''

  for (let index = 0; index < anchored.length; index++) {
    const char = anchored[index] as string
    const close = char === '[' ? classEnd(anchored, index) : -1

    if (char === '\\' && index + 1 < anchored.length) {
      source += literal(anchored[++index] as string)
    } else if (close !== -1) {
      source += classSource(anchored.slice(index + 1, close))
      index = close
    } else if (char === '*' && anchored[index + 1] === '*') {
      source += anchored[index + 2] === '/' ? '(?:.*/)?' : '.*'
      index += anchored[index + 2] === '/' ? 2 : 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += literal(char)
    }
  }

  return new RegExp(`^${source}(?:/.*)?$`)
}

/** A matcher for pawl's own checks, which follows every ignore the engines follow. */
export const ignoreMatcher = (
  root: string,
  policy: Pick<Policy, 'defaultIgnores' | 'gitignore' | 'ignore'>
): ((file: string) => boolean) => makeIgnore(allIgnores(root, policy))

/**
 * Match files against pawl globs. The last pattern that matches decides, so a `!` pattern
 * re-includes a file an earlier one ignored, as in .gitignore.
 */
export const makeIgnore = (patterns: readonly string[]): ((file: string) => boolean) => {
  const matchers = patterns.map(pattern => {
    const negated = pattern.startsWith('!')

    return { negated, regexp: globToRegExp(negated ? pattern.slice(1) : pattern) }
  })

  return file => {
    if (file.split('/').some(part => ALWAYS_IGNORED.includes(part))) return true

    let ignored = false

    for (const { negated, regexp } of matchers) {
      if (regexp.test(file)) ignored = !negated
    }

    return ignored
  }
}
