import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Policy } from '../types.ts'

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
  '.pnpm-store',
  // Lockfiles: written by the package manager, never by people. Cargo.lock is TOML and
  // Package.resolved is JSON, so a pack or Biome would otherwise reformat them.
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Package.resolved',
  // What the Swift, Xcode and Gradle tools write. Asset catalogs hold JSON that Xcode rewrites.
  '.build',
  '.swiftpm',
  'DerivedData',
  'xcuserdata',
  'Pods',
  '*.xcassets',
  '*.xcodeproj',
  '*.xcworkspace',
  '.gradle',
  '.kotlin',
  '.cxx',
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
  '.prisma',
  // Type declarations a framework's own command writes.
  'next-env.d.ts',
  'worker-configuration.d.ts',
  'cloudflare-env.d.ts',
  // Changelogs: written by the release tool.
  'CHANGELOG.md'
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
 * the build folders detection found, then the policy's own. Biome skips node_modules and .git by itself;
 * Oxlint is told to in its own config.
 */
export const configIgnores = (
  policy: Pick<Policy, 'defaultIgnores' | 'ignore'>,
  detected: readonly string[] = []
): string[] => [
  ...new Set(['.pawl', ...(policy.defaultIgnores ? [...DEFAULT_IGNORES, ...detected] : []), ...policy.ignore])
]

/**
 * Every pattern pawl skips for a project: the defaults and the build folders detection found,
 * the root .gitignore when the policy respects it, then the policy's own patterns. Order
 * matters for the `!` lines of a .gitignore.
 */
export const allIgnores = (
  root: string,
  policy: Pick<Policy, 'defaultIgnores' | 'gitignore' | 'ignore'>,
  detected: readonly string[] = []
): string[] => [
  ...(policy.defaultIgnores ? [...DEFAULT_IGNORES, ...detected] : []),
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

/**
 * A pattern with braces, such as `*.{js,ts}` or `{apps,tools}/*`, as the patterns it stands for, as a
 * shell, minimatch or EditorConfig reads them. Groups do not nest, and `\{` is a brace itself.
 */
export const expandBraces = (pattern: string): string[] => {
  const group = braceGroup(pattern)

  if (!group) return [pattern]

  const before = pattern.slice(0, group.open)
  const after = pattern.slice(group.close + 1)

  return pattern
    .slice(group.open + 1, group.close)
    .split(',')
    .flatMap(choice => expandBraces(`${before}${choice}${after}`))
}

/**
 * Where the first group of braces with a comma in it opens and closes. A scan, not a regular
 * expression, so a long pattern from a config file cannot make it slow.
 */
const braceGroup = (pattern: string): { open: number; close: number } | undefined => {
  let open = -1

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]

    if (char === '{') open = pattern[index - 1] === '\\' ? -1 : index
    else if (char === '}') {
      if (open !== -1 && pattern.slice(open + 1, index).includes(',')) return { open, close: index }

      open = -1
    }
  }

  return undefined
}

/** The POSIX classes git knows inside brackets, such as `[[:digit:]]`, in the ASCII range git reads. */
const POSIX_CLASSES: Readonly<Record<string, string>> = {
  alnum: 'a-zA-Z0-9',
  alpha: 'a-zA-Z',
  blank: ' \\t',
  cntrl: '\\x00-\\x1f\\x7f',
  digit: '0-9',
  graph: '\\x21-\\x7e',
  lower: 'a-z',
  print: '\\x20-\\x7e',
  punct: '!-\\/:-@\\[-`{-~',
  space: ' \\t\\n\\r\\f\\v',
  upper: 'A-Z',
  xdigit: '0-9A-Fa-f'
}

/** The class does not close, or names a POSIX class git does not know: git then matches nothing. */
const MALFORMED = Symbol('malformed')

/**
 * The character class of a .gitignore line that opens at `open`, such as `[cod]`, `[a-z]`, `[!_]` or
 * `[[:digit:]]`, read as git's wildmatch reads it, with the index of its `]`. It never matches a slash.
 * A range written backwards, such as `z-a`, matches only its first character, as in git.
 */
const readClass = (pattern: string, open: number): { source: string; end: number } | typeof MALFORMED => {
  const parts: string[] = []
  let index = open + 1
  let previous: string | undefined
  const negated = pattern[index] === '!' || pattern[index] === '^'

  if (negated) index++

  // The first character is one of the set even when it is `]`.
  for (let first = true; ; first = false) {
    let char = pattern[index]

    if (char === undefined) return MALFORMED

    if (char === ']' && !first) return { source: `(?!/)[${negated ? '^' : ''}${parts.join('')}]`, end: index }

    if (char === '\\') {
      char = pattern[++index]

      if (char === undefined) return MALFORMED
    } else if (char === '-' && previous !== undefined && index + 1 < pattern.length && pattern[index + 1] !== ']') {
      let high = pattern[++index] as string

      if (high === '\\') high = pattern[++index] ?? ''

      if (high === '') return MALFORMED

      if (high >= previous) parts.push(`${literal(previous)}-${literal(high)}`)

      previous = undefined
      index++

      continue
    } else if (char === '[' && pattern[index + 1] === ':') {
      const close = pattern.indexOf(']', index + 2)

      if (close === -1) return MALFORMED

      // Without `:]` the `[` is one of the characters, as in git.
      if (close - 1 >= index + 2 && pattern[close - 1] === ':') {
        const named = POSIX_CLASSES[pattern.slice(index + 2, close - 1)]

        if (named === undefined) return MALFORMED

        parts.push(named)
        previous = undefined
        index = close + 1

        continue
      }
    }

    parts.push(literal(char))
    previous = char
    index++
  }
}

/** A regular expression that matches nothing, for a line git cannot match anything with. */
const NOTHING = /(?!)/

/**
 * A small glob matcher: `**`, `*`, `?`, a character class in brackets, and a backslash to take the
 * next character as it is. A pattern without a slash matches at any depth.
 */
const globToRegExp = (pattern: string): RegExp => {
  const anchored = pattern.includes('/') ? pattern.replace(/^\.?\//, '') : `**/${pattern}`
  let source = ''

  for (let index = 0; index < anchored.length; index++) {
    const char = anchored[index] as string

    if (char === '\\' && index + 1 < anchored.length) {
      source += literal(anchored[++index] as string)
    } else if (char === '[') {
      const set = readClass(anchored, index)

      if (set === MALFORMED) return NOTHING

      source += set.source
      index = set.end
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
  policy: Pick<Policy, 'defaultIgnores' | 'gitignore' | 'ignore'>,
  detected: readonly string[] = []
): ((file: string) => boolean) => makeIgnore(allIgnores(root, policy, detected))

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
