/** Reading an ESLint config the way ESLint resolves it: the rules it turns on for sample files, and its ignores. */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type Pack } from '../../catalog/packs.ts'
import { importPlugin, packPreset, pluginPreset } from '../../engines/eslint/load.ts'
import { ESLINT_LEGACY_CONFIG_FILES, firstExisting } from '../../project/config-files.ts'
import { listFiles } from '../../project/files.ts'
import { ALWAYS_IGNORED, DEFAULT_IGNORES, literalBrackets, makeIgnore, WALK_SKIP } from '../../project/ignores.ts'
import { type Level } from '../../types.ts'
import { readJson } from '../../utils/json.ts'

/** Patterns pawl skips by default, so a migrated config need not list them. */
const COVERED = new Set([...ALWAYS_IGNORED, ...DEFAULT_IGNORES])

interface Resolved {
  level: Level
  options: unknown[]
}

export type RuleMap = Map<string, Resolved>

interface EslintConfig {
  rules?: Record<string, unknown>
  plugins?: Record<string, { rules?: Record<string, { meta?: { type?: string } }> }>
}

interface EslintApi {
  calculateConfigForFile: (file: string) => Promise<EslintConfig | undefined>
}

export type EslintClass = new (options: Record<string, unknown>) => EslintApi

const LEVELS: readonly Level[] = ['off', 'warn', 'error']

export const rank = (level: Level): number => LEVELS.indexOf(level)

const toLevel = (value: unknown): Level => {
  const severity = Array.isArray(value) ? (value[0] as unknown) : value

  if (severity === 2 || severity === 'error') return 'error'

  return severity === 1 || severity === 'warn' ? 'warn' : 'off'
}

/** One sample per kind of file, so rules that only apply to tests or to data files are seen too. */
const SAMPLE_KINDS: ReadonlyArray<{ test: RegExp; fallback?: string }> = [
  { test: /(?<!\.d)\.(ts|mts|cts)$/, fallback: 'src/index.ts' },
  { test: /\.tsx$/ },
  { test: /\.(js|mjs|cjs)$/, fallback: 'src/index.js' },
  { test: /\.jsx$/ },
  { test: /\.(test|spec)\.[cm]?[jt]sx?$/ },
  { test: /\.vue$/ },
  { test: /\.svelte$/ },
  { test: /\.astro$/ },
  { test: /\.json$/ },
  { test: /\.ya?ml$/ },
  { test: /\.md$/ },
  { test: /\.toml$/ },
  { test: /\.html$/ }
]

const TEST_FILE = /\.(test|spec)\.|(^|\/)__tests__\//

const CONFIG_FILE = /(^|\/)[^/]*\.config\.[cm]?[jt]s$/

const SAMPLE_TRIES = 5

/** Formatting plugins, whose every rule is the formatter's job. */
const FORMAT_PREFIXES = /^(@stylistic(\/[a-z]+)?|style|prettier)$/

/** Plugins for template languages. The formatter does not replace their layout rules. */
const TEMPLATE_PREFIXES = new Set(['vue', 'svelte', 'astro', 'html', '@html-eslint'])

export const IMPORT_SORTING = new Set([
  'sort-imports',
  'import/order',
  'import-x/order',
  'simple-import-sort/imports',
  'simple-import-sort/exports'
])

/** ESLint's own formatting rules, for versions of ESLint that no longer ship them. */
const CORE_FORMATTING = new Set([
  'array-bracket-spacing',
  'arrow-parens',
  'arrow-spacing',
  'block-spacing',
  'brace-style',
  'comma-dangle',
  'comma-spacing',
  'comma-style',
  'eol-last',
  'func-call-spacing',
  'indent',
  'jsx-quotes',
  'key-spacing',
  'keyword-spacing',
  'linebreak-style',
  'max-len',
  'no-extra-semi',
  'no-mixed-spaces-and-tabs',
  'no-multi-spaces',
  'no-multiple-empty-lines',
  'no-trailing-spaces',
  'object-curly-spacing',
  'padded-blocks',
  'quote-props',
  'quotes',
  'semi',
  'semi-spacing',
  'space-before-blocks',
  'space-before-function-paren',
  'space-in-parens',
  'space-infix-ops'
])

export const splitName = (name: string): { prefix: string; short: string } => {
  const slash = name.lastIndexOf('/')

  return slash === -1 ? { prefix: '', short: name } : { prefix: name.slice(0, slash), short: name.slice(slash + 1) }
}

export type CoreRules = Map<string, { meta?: { type?: string } }> | undefined

/** Whether a rule only arranges code, which is the formatter's job once pawl is in place. */
const isFormatting = (name: string, config: EslintConfig, core: CoreRules): boolean => {
  const { prefix, short } = splitName(name)

  if (FORMAT_PREFIXES.test(prefix)) return true

  if (TEMPLATE_PREFIXES.has(prefix)) return false

  if (prefix === '') return core?.get(name)?.meta?.type === 'layout' || CORE_FORMATTING.has(name)

  return config.plugins?.[prefix]?.rules?.[short]?.meta?.type === 'layout'
}

export const pickSamples = (root: string, typescript: boolean): string[][] => {
  const files = listFiles(root).filter(file => !file.split('/').some(part => WALK_SKIP.has(part)))
  // Source files first: they carry the rules that matter most.
  const ordered = [...files.filter(file => file.startsWith('src/')), ...files.filter(file => !file.startsWith('src/'))]
  const groups: string[][] = []

  for (const [index, kind] of SAMPLE_KINDS.entries()) {
    const isTestKind = index === 4
    const found = ordered
      .filter(file => kind.test.test(file) && (isTestKind || !TEST_FILE.test(file)) && !CONFIG_FILE.test(file))
      .slice(0, SAMPLE_TRIES)
    const wanted = kind.fallback !== undefined && (typescript || !kind.fallback.endsWith('.ts'))

    if (found.length > 0) groups.push(found)
    else if (wanted && kind.fallback !== undefined) groups.push([kind.fallback])
  }

  return groups
}

export interface Side {
  rules: RuleMap
  formatting: RuleMap
  samples: string[]
}

/** Resolve the rules of one ESLint setup for each sample, keeping the strictest level seen for each rule. */
export const resolveSide = async (eslint: EslintApi, groups: readonly string[][], core: CoreRules): Promise<Side> => {
  const side: Side = { rules: new Map(), formatting: new Map(), samples: [] }

  for (const group of groups) {
    for (const file of group) {
      const config = await eslint.calculateConfigForFile(file)

      if (!config?.rules) continue

      side.samples.push(file)

      for (const [name, value] of Object.entries(config.rules)) {
        const target = isFormatting(name, config, core) ? side.formatting : side.rules
        const level = toLevel(value)
        const seen = target.get(name)

        if (!seen || rank(level) > rank(seen.level))
          target.set(name, { level, options: Array.isArray(value) ? value.slice(1) : [] })
      }

      break
    }
  }

  return side
}

export const on = (map: RuleMap): string[] => [...map].flatMap(([name, { level }]) => (level === 'off' ? [] : [name]))

export const first = (rules: RuleMap, short: string): Resolved | undefined =>
  [...rules].find(([name, { level }]) => level !== 'off' && splitName(name).short === short)?.[1]

/** The folders the old config skips everywhere, read from its global `ignores`. */
export const readIgnores = async (file: string): Promise<string[] | undefined> => {
  if (!/\.[cm]?js$/.test(file)) return undefined

  try {
    const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown }
    const entries = await loaded.default

    if (!Array.isArray(entries)) return undefined

    const patterns = (entries as Record<string, unknown>[])
      .filter(
        entry => Array.isArray(entry.ignores) && Object.keys(entry).every(key => key === 'ignores' || key === 'name')
      )
      .flatMap(entry => entry.ignores as unknown[])
      .filter((pattern): pattern is string => typeof pattern === 'string' && !pattern.startsWith('!'))

    return [
      ...new Set(
        patterns
          .map(pattern => pattern.replace(/\/\*\*(\/\*)?$/, '').replace(/\/$/, ''))
          .filter(pattern => pattern.length > 0 && !COVERED.has(pattern.replace(/^\*\*\//, '')))
      )
    ]
  } catch {
    return undefined
  }
}

/** How many rules of a preset the old config has to share, at the same level, to count as following it. */
const PRESET_MATCHES = 20

/**
 * How the old config relates to a pack whose plugin it uses: the pack as it is (`plain`), the pack
 * started from the plugin's own recommended preset (`recommended`), or not at all (`none`).
 */
export const packFit = async (root: string, pack: Pack, rules: RuleMap): Promise<'plain' | 'recommended' | 'none'> => {
  // A base pack brings a whole preset with it. A few rules of its plugin do not call for that.
  const isBase = pack.auto !== undefined

  if (pack.preset && !isBase) return 'plain'

  const plugin = (await importPlugin(root, pack.plugin)).module

  if (!plugin) return isBase ? 'none' : 'plain'

  const preset = pack.preset ? packPreset(pack, plugin) : pluginPreset(plugin, 'recommended', pack.prefix)
  const matches = Object.entries(preset ?? {}).filter(([name, value]) => {
    const level = toLevel(value)

    return level !== 'off' && rules.get(name)?.level === level
  })
  const follows = matches.length >= PRESET_MATCHES

  if (isBase) return follows ? 'plain' : 'none'

  return follows ? 'recommended' : 'plain'
}

/** The legacy ESLint config of a project: an .eslintrc file, or `eslintConfig` in package.json. */
export const legacyConfig = (root: string): string | undefined =>
  firstExisting(root, ESLINT_LEGACY_CONFIG_FILES) ??
  (readJson<{ eslintConfig?: unknown }>(join(root, 'package.json'))?.eslintConfig ? 'package.json' : undefined)

/** The patterns of a legacy config's .eslintignore file. */
export const readLegacyIgnores = (root: string): string[] => {
  const file = join(root, '.eslintignore')

  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\//, '').replace(/\/$/, ''))
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('!') && !COVERED.has(line))
}

/** How many patterns one ignore pattern of the old config may be listed out into. */
const LISTED_LIMIT = 32

/** A character as it is in a pawl glob, where `*`, `?`, brackets and the backslash are special. */
const globLiteral = (char: string): string => char.replace(/[*?[\]\\]/g, '\\$&')

/**
 * An ignore pattern of the old config with its character classes listed out, such as `*.min.[jc]s`
 * as `*.min.js` and `*.min.cs`: in a pawl pattern brackets are the characters themselves. Undefined
 * for a class that cannot be listed, such as `[!a]`, or one that would make too many patterns.
 */
const listClasses = (pattern: string): string[] | undefined => {
  const open = pattern.search(/(?<!\\)\[/)

  if (open === -1) return [pattern]

  // The first character of a class may be `]` itself.
  const close = pattern.indexOf(']', open + 2)

  if (close === -1) return [pattern]

  const body = pattern.slice(open + 1, close)

  if (/^[!^]/.test(body) || body.includes('[:')) return undefined

  const chars = new Set<string>()

  for (let index = 0; index < body.length; index++) {
    const low = body[index] === '\\' ? (body[++index] ?? '') : (body[index] as string)

    if (body[index + 1] === '-' && index + 2 < body.length) {
      const high = body[index + 2] as string

      for (let code = low.charCodeAt(0); code <= high.charCodeAt(0) && chars.size <= LISTED_LIMIT; code++) {
        chars.add(String.fromCharCode(code))
      }

      index += 2
    } else chars.add(low)
  }

  // A range written backwards, such as `[z-a]`, lists nothing.
  if (chars.size === 0) return undefined

  const listed: string[] = []

  for (const char of chars) {
    const rest = listClasses(`${pattern.slice(0, open)}${globLiteral(char)}${pattern.slice(close + 1)}`)

    if (!rest) return undefined

    listed.push(...rest)
  }

  return listed.length <= LISTED_LIMIT ? listed : undefined
}

/** `@(a|b)` in a minimatch pattern, which stands for `a` or `b`. */
const EXTGLOB_ONE = /(?<!\\)@\(([^()]*)\)/

/** The other extglobs, such as `!(a)` or `+(a)`, which no list of names can stand for. */
const EXTGLOB_OTHER = /(?<!\\)[!*+?]\([^()]*\)/

/** An extglob `@(a|b)` as the patterns it stands for, or undefined for one no list can say. */
const listExtglobs = (pattern: string): string[] | undefined => {
  if (EXTGLOB_OTHER.test(pattern)) return undefined

  const group = EXTGLOB_ONE.exec(pattern)

  if (!group) return [pattern]

  const before = pattern.slice(0, group.index)
  const after = pattern.slice(group.index + group[0].length)
  const listed: string[] = []

  for (const choice of (group[1] ?? '').split('|')) {
    const rest = listExtglobs(`${before}${choice}${after}`)

    if (!rest) return undefined

    listed.push(...rest)
  }

  return listed
}

/** What a pawl pattern reads as the characters themselves: brackets and extglobs. */
const NOT_LITERAL = /(?<!\\)\[|(?<!\\)[@!*+?]\(/

/**
 * The ignore patterns of the old config as pawl reads them. A pattern with brackets that names
 * paths in the project as they are, such as a route folder `app/[slug]`, stays as it is. Any other
 * has its extglobs and classes listed out, or is left out with a note when they cannot be.
 */
export const policyIgnores = (root: string, patterns: readonly string[], notes: string[]): string[] => {
  let files: string[] | undefined

  return patterns.flatMap(pattern => {
    if (!NOT_LITERAL.test(pattern)) return [pattern]

    files ??= listFiles(root)

    if (files.some(makeIgnore([literalBrackets(pattern)]))) return [pattern]

    const extglobs = listExtglobs(pattern)
    const listed = extglobs?.map(listClasses)

    if (listed?.every(item => item !== undefined)) {
      const all = listed.flat()

      if (all.length <= LISTED_LIMIT) return all
    }

    notes.push(
      `The ignore pattern "${pattern}" has a part pawl cannot list out, such as a character class or an extglob. Add the paths it skips to "ignore" in the policy.`
    )

    return []
  })
}
