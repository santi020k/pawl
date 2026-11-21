import { existsSync, readFileSync, renameSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allTechnologies, detect } from './detect.ts'
import { eslintPlan, importFromProject, importPlugin, packPreset, pluginPreset } from './engines/eslint.ts'
import { listFiles, readJson, readJsonc, writeText } from './fs-utils.ts'
import { ALWAYS_IGNORED, DEFAULT_IGNORES, expandBraces, literalBrackets, makeIgnore, WALK_SKIP } from './ignores.ts'
import { ESLINT_CONFIG, type InitAction, policyFile } from './init.ts'
import { getPack, PACKS, type Pack } from './packs.ts'
import { DEFAULT_STYLE, effectiveRules, findConfigFile, resolvePolicy } from './policy.ts'
import { getRule, type RuleDef } from './rules.ts'
import { ESLINT_CONFIG_FILES } from './tools.ts'
import { type Level, type PolicyInput, type StyleOptions } from './types.ts'
import { PACKAGE_NAME } from './version.ts'

/** Patterns pawl skips by default, so a migrated config need not list them. */
const COVERED = new Set([...ALWAYS_IGNORED, ...DEFAULT_IGNORES])

/** Where the full account of a migration is written. */
export const MIGRATION_REPORT = '.pawl/migration.md'

export interface MigrateOptions {
  root: string
  /** Leave the ESLint config file as it is and only write the policy. */
  keepConfig?: boolean
}

export interface RuleChange {
  rule: string
  /** The level the pawl standard and its packs would set. */
  standard: Level
  /** The level the old config set, which the policy keeps. */
  kept: Level
}

export interface MigratePlan {
  /** The ESLint config that was read, relative to the root. */
  source: string
  /** The files whose resolved configuration was compared. */
  samples: string[]
  policy: PolicyInput
  actions: InitAction[]
  notes: string[]
  /** Rules that are on in the old config. */
  total: number
  /** Rules the pawl standard and its packs already set to the same level. */
  same: number
  /** Rules whose level the policy carries over because it differs from the standard. */
  changed: RuleChange[]
  /** Rules that are on in the standard and its packs and were not in the old config. */
  added: string[]
  /** Formatting rules. The formatter does their job. */
  formatting: string[]
  /** Import ordering rules. Import sorting does their job. */
  importSorting: string[]
  packs: string[]
  /** Rules whose options the policy carries, that Biome enforces with its own options when it is the linter. */
  biomeOptions: string[]
  /** Rules the policy names that cannot run, and what each one needs. */
  notEnforced: Array<{ rule: string; needs: string }>
}

interface Resolved {
  level: Level
  options: unknown[]
}

type RuleMap = Map<string, Resolved>

interface EslintConfig {
  rules?: Record<string, unknown>
  plugins?: Record<string, { rules?: Record<string, { meta?: { type?: string } }> }>
}

interface EslintApi {
  calculateConfigForFile: (file: string) => Promise<EslintConfig | undefined>
}

type EslintClass = new (options: Record<string, unknown>) => EslintApi

const LEVELS: readonly Level[] = ['off', 'warn', 'error']

const rank = (level: Level): number => LEVELS.indexOf(level)

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

const IMPORT_SORTING = new Set([
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

const splitName = (name: string): { prefix: string; short: string } => {
  const slash = name.lastIndexOf('/')

  return slash === -1 ? { prefix: '', short: name } : { prefix: name.slice(0, slash), short: name.slice(slash + 1) }
}

type CoreRules = Map<string, { meta?: { type?: string } }> | undefined

/** Whether a rule only arranges code, which is the formatter's job once pawl is in place. */
const isFormatting = (name: string, config: EslintConfig, core: CoreRules): boolean => {
  const { prefix, short } = splitName(name)

  if (FORMAT_PREFIXES.test(prefix)) return true

  if (TEMPLATE_PREFIXES.has(prefix)) return false

  if (prefix === '') return core?.get(name)?.meta?.type === 'layout' || CORE_FORMATTING.has(name)

  return config.plugins?.[prefix]?.rules?.[short]?.meta?.type === 'layout'
}

const pickSamples = (root: string, typescript: boolean): string[][] => {
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

interface Side {
  rules: RuleMap
  formatting: RuleMap
  samples: string[]
}

/** Resolve the rules of one ESLint setup for each sample, keeping the strictest level seen for each rule. */
const resolveSide = async (eslint: EslintApi, groups: readonly string[][], core: CoreRules): Promise<Side> => {
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

const on = (map: RuleMap): string[] => [...map].flatMap(([name, { level }]) => (level === 'off' ? [] : [name]))

const first = (rules: RuleMap, short: string): Resolved | undefined =>
  [...rules].find(([name, { level }]) => level !== 'off' && splitName(name).short === short)?.[1]

interface PrettierOptions {
  singleQuote?: boolean
  semi?: boolean
  tabWidth?: number
  useTabs?: boolean
  printWidth?: number
  trailingComma?: string
  arrowParens?: string
}

const isOptions = (value: unknown): value is PrettierOptions =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The Prettier options of a project, when its config is one pawl can read: JSON, in a file or in package.json. */
const readPrettier = (root: string): PrettierOptions | undefined =>
  [
    readJsonc<unknown>(join(root, '.prettierrc')).value,
    readJsonc<unknown>(join(root, '.prettierrc.json')).value,
    readJson<{ prettier?: unknown }>(join(root, 'package.json'))?.prettier
  ].find(isOptions)

/** The widest line Biome formats to. */
const WIDEST_LINE = 320

/**
 * The options Prettier takes from the root .editorconfig for the project's scripts, as Prettier's CLI
 * reads them for an option its own config leaves out. Later sections win, as in EditorConfig.
 */
export const readEditorconfig = (root: string): PrettierOptions => {
  let text: string

  try {
    text = readFileSync(join(root, '.editorconfig'), 'utf8')
  } catch {
    return {}
  }

  const scripts = ['src/index.ts', 'src/index.js']
  const values: Record<string, string> = {}
  let applies = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()

    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue

    const section = /^\[(.*)\]$/.exec(line)

    if (section) {
      const matches = makeIgnore(expandBraces(section[1] ?? ''))

      applies = scripts.some(matches)
    } else if (applies) {
      const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line)

      if (pair?.[1] && pair[2] !== undefined) values[pair[1].toLowerCase()] = pair[2].toLowerCase()
    }
  }

  // What the EditorConfig parser Prettier uses fills in, as the EditorConfig spec says: a tab
  // indent has the tab's width, and one of the two widths stands for the other.
  if (values.indent_style === 'tab' && values.indent_size === undefined) values.indent_size = 'tab'

  if (values.indent_size !== undefined && values.indent_size !== 'tab' && values.tab_width === undefined) {
    values.tab_width = values.indent_size
  }

  if (values.indent_size === 'tab' && values.tab_width !== undefined) values.indent_size = values.tab_width

  // The same reading as Prettier's own, in src/config/editorconfig/editorconfig-to-prettier.js.
  const size = (value: string | undefined): number | undefined =>
    value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : undefined
  const options: PrettierOptions = {}

  if (values.indent_style === 'space') options.useTabs = false
  else if (values.indent_style === 'tab' || values.indent_size === 'tab') options.useTabs = true

  const width =
    options.useTabs === false ? (size(values.indent_size) ?? size(values.tab_width)) : size(values.tab_width)

  if (width !== undefined) options.tabWidth = width

  // `off` is no limit at all. The widest a style can be is the widest Biome formats to.
  const lineWidth = values.max_line_length === 'off' ? WIDEST_LINE : size(values.max_line_length)

  if (lineWidth !== undefined) options.printWidth = lineWidth

  if (values.quote_type === 'single' || values.quote_type === 'double') {
    options.singleQuote = values.quote_type === 'single'
  }

  return options
}

/**
 * What Prettier does with an option its config leaves out. A project with a Prettier config is
 * formatted this way already, so these are part of its style as much as the options it wrote down.
 */
const PRETTIER_DEFAULTS = {
  singleQuote: false,
  semi: true,
  tabWidth: 2,
  useTabs: false,
  printWidth: 80,
  trailingComma: 'all',
  arrowParens: 'always'
} satisfies Required<PrettierOptions>

const indentOf = (value: unknown): StyleOptions['indent'] | undefined => {
  if (value === 'tab') return 'tab'

  return value === 2 || value === 4 ? value : undefined
}

const commasOf = (value: unknown): StyleOptions['trailingCommas'] | undefined => {
  const setting = typeof value === 'object' && value !== null ? (value as { arrays?: unknown }).arrays : value

  if (typeof setting !== 'string') return undefined

  return setting === 'never' || setting === 'none' ? 'none' : 'all'
}

/** Read the formatting style out of the old formatting rules, then out of a Prettier config when there is one. */
const styleFrom = (formatting: RuleMap, prettier: PrettierOptions | undefined): Partial<StyleOptions> => {
  const style: { [Key in keyof StyleOptions]?: StyleOptions[Key] | undefined } = {}
  const option = (short: string): unknown => first(formatting, short)?.options[0]
  const quotes = option('quotes')
  const semi = first(formatting, 'semi')
  const maxLen = option('max-len')
  const arrow = option('arrow-parens')

  if (quotes === 'single' || quotes === 'double') style.quotes = quotes

  if (semi) style.semicolons = semi.options[0] !== 'never'

  style.indent = indentOf(option('indent'))
  style.trailingCommas = commasOf(option('comma-dangle'))
  style.lineWidth = typeof maxLen === 'number' ? maxLen : (maxLen as { code?: number } | undefined)?.code

  if (arrow === 'as-needed' || arrow === 'always') style.arrowParens = arrow

  // Prettier formats the code, so its options decide, the ones it defaults to included.
  if (prettier) {
    const set = { ...PRETTIER_DEFAULTS, ...prettier }

    style.quotes = set.singleQuote ? 'single' : 'double'
    style.semicolons = set.semi
    style.indent = set.useTabs ? 'tab' : (indentOf(set.tabWidth) ?? style.indent)
    style.trailingCommas = commasOf(set.trailingComma) ?? style.trailingCommas
    style.lineWidth = typeof set.printWidth === 'number' ? set.printWidth : style.lineWidth
    style.arrowParens = set.arrowParens === 'avoid' ? 'as-needed' : 'always'
  }

  // A wider line than Biome formats to means no limit in practice, and the policy refuses one.
  if (style.lineWidth !== undefined) style.lineWidth = Math.min(style.lineWidth, WIDEST_LINE)

  // Only what differs from the standard is worth writing down.
  return Object.fromEntries(
    Object.entries(style).filter(
      ([key, value]) => value !== undefined && value !== DEFAULT_STYLE[key as keyof StyleOptions]
    )
  ) as Partial<StyleOptions>
}

/** The folders the old config skips everywhere, read from its global `ignores`. */
const readIgnores = async (file: string): Promise<string[] | undefined> => {
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
const packFit = async (root: string, pack: Pack, rules: RuleMap): Promise<'plain' | 'recommended' | 'none'> => {
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

const TS_TWIN = '@typescript-eslint/'

/** The catalog rule a name stands for. The typescript-eslint twin of a core rule stands for that rule. */
const catalogRule = (name: string): RuleDef | undefined =>
  getRule(name) ?? (name.startsWith(TS_TWIN) ? getRule(name.slice(TS_TWIN.length)) : undefined)

/** Options worth carrying: more than the empty defaults ESLint fills in. */
const hasOptions = (options: unknown[]): boolean => !['[]', '[{}]'].includes(JSON.stringify(options))

const LEGACY_FILES = ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc']

/** The legacy ESLint config of a project: an .eslintrc file, or `eslintConfig` in package.json. */
const legacyConfig = (root: string): string | undefined =>
  LEGACY_FILES.find(name => existsSync(join(root, name))) ??
  (readJson<{ eslintConfig?: unknown }>(join(root, 'package.json'))?.eslintConfig ? 'package.json' : undefined)

/** How many patterns one ignore pattern of the old config may be listed out into. */
const LISTED_LIMIT = 32

/** A character as it is in a pawl glob, where `*`, `?`, brackets and the backslash are special. */
const globLiteral = (char: string): string => char.replace(/[*?[\]\\]/, '\\$&')

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

/**
 * The ignore patterns of the old config as pawl reads them. A pattern with brackets that names
 * paths in the project as they are, such as a route folder `app/[slug]`, stays as it is. Any other
 * has its classes listed out, or is left out with a note when they cannot be.
 */
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
const policyIgnores = (root: string, patterns: readonly string[], notes: string[]): string[] => {
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

/** The patterns of a legacy config's .eslintignore file. */
const readLegacyIgnores = (root: string): string[] => {
  const file = join(root, '.eslintignore')

  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\//, '').replace(/\/$/, ''))
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('!') && !COVERED.has(line))
}

const sameOptions = (a: unknown[], b: unknown[]): boolean => JSON.stringify(a) === JSON.stringify(b)

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const NEW_EXTENSION: Record<string, string> = { '.cjs': '.mjs', '.cts': '.mts' }

const reportFile = (plan: Omit<MigratePlan, 'actions'>, backup: string | undefined): string => {
  const list = (items: readonly string[]): string =>
    items.length > 0 ? items.map(item => `- \`${item}\``).join('\n') : 'None.'
  const lines = [
    '# Migration to pawl',
    '',
    `Read from \`${plan.source}\`, comparing ${plural(plan.samples.length, 'file')}: ${plan.samples.map(file => `\`${file}\``).join(', ')}.`,
    ...(backup
      ? ['', `The old config is kept as \`${backup}\`. Delete it, and this file, when you are happy with the result.`]
      : []),
    '',
    '## Summary',
    '',
    `- ${plural(plan.total, 'rule')} on in the old config.`,
    `- ${plan.same} already at the same level in the pawl standard and its packs.`,
    `- ${plan.changed.length} carried into the policy because the old level differs.`,
    `- ${plan.formatting.length} formatting rules, now done by the formatter.`,
    `- ${plan.importSorting.length} import ordering rules, now done by import sorting.`,
    `- ${plan.added.length} rules the pawl standard and its packs add. Their existing findings go into the baseline.`,
    '',
    '## Levels kept from the old config',
    '',
    'These are in `rules` in the policy file. Delete a line to take the standard level.',
    '',
    ...(plan.changed.length > 0
      ? [
          '| Rule | Standard | Kept |',
          '| --- | --- | --- |',
          ...plan.changed.map(change => `| \`${change.rule}\` | ${change.standard} | ${change.kept} |`)
        ]
      : ['None.']),
    '',
    '## Options Biome does not take',
    '',
    'The policy carries the options of these rules for ESLint and Oxlint. Where Biome is the linter, it enforces them with its own options.',
    '',
    list(plan.biomeOptions),
    '',
    '## Rules that cannot run yet',
    '',
    ...(plan.notEnforced.length > 0
      ? plan.notEnforced.map(item => `- \`${item.rule}\` needs ${item.needs}`)
      : ['None.']),
    '',
    '## Replaced by the formatter',
    '',
    list(plan.formatting),
    '',
    '## Replaced by import sorting',
    '',
    list(plan.importSorting),
    '',
    '## Added by the standard',
    '',
    list(plan.added),
    ''
  ]

  return lines.join('\n')
}

/** Read an existing ESLint flat config and work out the pawl policy that keeps its rules. */
export const planMigrate = async ({ root, keepConfig = false }: MigrateOptions): Promise<MigratePlan> => {
  const flatName = ESLINT_CONFIG_FILES.find(name => existsSync(join(root, name)))
  const legacyName = flatName ? undefined : legacyConfig(root)
  const sourceName = flatName ?? legacyName

  if (!sourceName) throw new Error('No ESLint config here: neither a flat config (eslint.config.js) nor an .eslintrc.')

  const sourcePath = join(root, sourceName)

  if (flatName && readFileSync(sourcePath, 'utf8').includes(PACKAGE_NAME))
    throw new Error(`${sourceName} is already built from ${PACKAGE_NAME}. There is nothing to migrate.`)

  const existing = findConfigFile(root)

  if (existing)
    throw new Error(`${existing.slice(root.length + 1)} already exists. Move it away to migrate from ${sourceName}.`)

  const { module: eslintModule, error } = await importFromProject(root, 'eslint')
  const Eslint = eslintModule?.ESLint as EslintClass | undefined

  if (!Eslint) throw new Error(`ESLint has to be installed here to read ${sourceName}.${error ? ` ${error}` : ''}`)

  const { module: unsupported } = await importFromProject(root, 'eslint/use-at-your-own-risk')
  const core = unsupported?.builtinRules as CoreRules
  const major = Number.parseInt(
    String(eslintModule?.ESLint ? (Eslint as unknown as { version?: string }).version : ''),
    10
  )
  // ESLint 9 keeps the old config system in a class of its own. ESLint 8 has the new one in a class of its own.
  const Legacy = (major >= 9 ? unsupported?.LegacyESLint : Eslint) as EslintClass | undefined
  const Flat = (major >= 9 ? Eslint : unsupported?.FlatESLint) as EslintClass | undefined

  if (legacyName && !Legacy) {
    throw new Error(
      `${legacyName} is a legacy config, and ESLint ${major} no longer reads those. Run "npx @eslint/migrate-config ${legacyName}" first, or migrate with ESLint 9 installed.`
    )
  }

  const Reader = (legacyName ? Legacy : Eslint) as EslintClass
  const detection = detect(root)
  const context = {
    typescript: detection.typescript,
    technologies: allTechnologies(detection),
    dependencies: detection.dependencies
  }
  const groups = pickSamples(root, detection.typescript)
  const old = await resolveSide(new Reader({ cwd: root }), groups, core)

  if (old.samples.length === 0) throw new Error(`${sourceName} does not apply to any file pawl could find.`)

  const notes: string[] = []
  const policyPath = join(root, 'pawl.config.ts')
  /** Resolve what pawl would hand ESLint for a policy, were ESLint the only linter. */
  const pawlSide = async (input: PolicyInput): Promise<{ side: Side; notEnforced: MigratePlan['notEnforced'] }> => {
    const plan = await eslintPlan({
      root,
      policy: await resolvePolicy(input, policyPath),
      biomeActive: false,
      ...context,
      dependencies: detection.dependencies
    })
    if (!Flat) throw new Error(`ESLint ${major} cannot load a flat config`)

    const eslint = new Flat({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })

    return {
      side: await resolveSide(
        eslint,
        old.samples.map(file => [file]),
        core
      ),
      notEnforced: plan.notEnforced
    }
  }

  // Packs: one for every plugin the old config has rules on from.
  const prefixes = new Set(on(old.rules).map(name => splitName(name).prefix))
  const packs: string[] = []
  const namedPacks: string[] = []

  for (const pack of PACKS.filter(candidate => prefixes.has(candidate.prefix))) {
    const fit = await packFit(root, pack, old.rules)

    if (fit === 'none') continue

    const entry = fit === 'recommended' ? `${pack.name}/recommended` : pack.name

    packs.push(entry)

    // A pack whose trigger the project depends on switches on by itself and needs no line in the policy.
    if (entry !== pack.name || !pack.when.some(name => detection.dependencies.includes(name))) namedPacks.push(entry)
  }

  let standard: Side = { rules: new Map(), formatting: new Map(), samples: [] }
  let comparable = true

  try {
    standard = (await pawlSide({ packs })).side
  } catch (cause) {
    comparable = false
    notes.push(
      `Could not resolve the pawl standard through ESLint (${(cause as Error).message.split('\n')[0]}). Every plugin rule that is on was carried over as is.`
    )
  }

  const effective = effectiveRules(await resolvePolicy({ packs }, policyPath), context)
  const rules: Record<string, Level> = {}
  const changed: RuleChange[] = []
  const importSorting: string[] = []
  const catalog = new Map<string, Level>()
  let same = 0

  for (const [name, { level }] of old.rules) {
    if (IMPORT_SORTING.has(name)) {
      if (level !== 'off') importSorting.push(name)

      continue
    }

    const def = catalogRule(name)

    // A catalog rule can show up under several names. The strictest one speaks for it.
    if (def) {
      const seen = catalog.get(def.name)

      if (!seen || rank(level) > rank(seen)) catalog.set(def.name, level)

      continue
    }

    const pawlLevel = standard.rules.get(name)?.level ?? 'off'

    if (level === pawlLevel || (!comparable && level === 'off')) {
      if (level !== 'off') same += 1

      continue
    }

    rules[name] = level
    changed.push({ rule: name, standard: pawlLevel, kept: level })
  }

  for (const [name, level] of catalog) {
    const pawlLevel = effective.get(name) ?? 'off'

    if (level === pawlLevel) {
      if (level !== 'off') same += 1

      continue
    }

    rules[name] = level
    changed.push({ rule: name, standard: pawlLevel, kept: level })
  }

  const added = [
    ...[...effective].flatMap(([name, level]) =>
      level !== 'off' && !catalog.has(name) && !name.startsWith('pawl/') ? [name] : []
    ),
    ...on(standard.rules).filter(name => !catalogRule(name) && !old.rules.has(name))
  ].sort()

  changed.sort((a, b) => a.rule.localeCompare(b.rule))

  const configured = readPrettier(root)
  // Prettier's CLI reads .editorconfig for what its own config leaves out.
  const prettier = configured && { ...readEditorconfig(root), ...configured }
  const style = styleFrom(old.formatting, prettier)

  if (detection.tools.prettier && !prettier) {
    notes.push(
      `Could not read the Prettier config in ${detection.tools.prettier}. Set "style" in the policy to match it, or "pawl fix" will format the code to the standard's style.`
    )
  }
  const read = legacyName ? readLegacyIgnores(root) : await readIgnores(sourcePath)
  const ignore = read && policyIgnores(root, read, notes)
  const policy: PolicyInput = {
    ...(namedPacks.length > 0 ? { packs: namedPacks } : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(ignore && ignore.length > 0 ? { ignore } : {}),
    ...(changed.length > 0
      ? { rules: Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))) }
      : {})
  }

  if (ignore === undefined)
    notes.push(
      `Could not read the ignore patterns of ${sourceName}. Add the folders to skip to "ignore" in the policy.`
    )

  // With the levels settled, see which rules cannot run and which options differ from what pawl would set.
  const options: Record<string, unknown[]> = {}
  const biomeOptions: string[] = []
  let notEnforced: MigratePlan['notEnforced'] = []

  try {
    const final = await pawlSide({ ...policy, packs })

    // Only what the migration brought in: the standard's own gaps are for "pawl doctor" to report.
    const packTitles = new Set(packs.map(entry => `The ${getPack(entry)?.title} pack`))

    notEnforced = final.notEnforced.filter(item => item.rule in rules || packTitles.has(item.rule))

    for (const [name, resolved] of old.rules) {
      const mine = final.side.rules.get(name)
      const def = catalogRule(name)

      if (resolved.level === 'off' || !mine || mine.level === 'off') continue

      if (!hasOptions(resolved.options) || sameOptions(resolved.options, mine.options)) continue

      options[def?.name ?? name] = resolved.options

      if (def?.biome !== undefined) biomeOptions.push(def.name)
    }
  } catch {
    // The first attempt already left a note.
  }

  if (Object.keys(options).length > 0)
    policy.options = Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)))

  const formatting = on(old.formatting).sort()
  const total = on(old.rules).length + formatting.length
  const extension = extname(sourceName)
  // A legacy config is not read by a flat-config ESLint, so it can stay where it is.
  const backup = keepConfig || legacyName ? undefined : `eslint.config.before-pawl${extension}`
  const target = legacyName ? 'eslint.config.js' : `eslint.config${NEW_EXTENSION[extension] ?? extension}`
  const summary = {
    source: sourceName,
    samples: old.samples,
    policy,
    notes,
    total,
    same,
    changed,
    added,
    formatting,
    importSorting: importSorting.sort(),
    packs,
    biomeOptions: biomeOptions.sort(),
    notEnforced
  }
  const carried = [
    changed.length > 0 ? plural(changed.length, 'rule level') : '',
    policy.options ? `options for ${plural(Object.keys(policy.options).length, 'rule')}` : '',
    namedPacks.length > 0 ? plural(namedPacks.length, 'pack') : '',
    Object.keys(style).length > 0 ? 'style' : '',
    ignore && ignore.length > 0 ? 'ignores' : ''
  ].filter(Boolean)
  const actions: InitAction[] = [
    {
      path: 'pawl.config.ts',
      kind: 'create',
      summary: carried.length > 0 ? carried.join(', ') : 'the standard as is',
      apply: () => writeText(policyPath, policyFile(policy))
    }
  ]

  if (legacyName && !keepConfig) {
    actions.push({
      path: target,
      kind: 'create',
      summary: 'eslint() from pawl',
      apply: () => writeText(join(root, target), ESLINT_CONFIG)
    })
    notes.push(`${legacyName} is no longer read. Delete it when you are happy with the result.`)

    if (major < 9) notes.push(`Pawl needs ESLint 9.22 or newer. This project has ESLint ${major}: upgrade it.`)
  } else if (backup) {
    actions.push({
      path: target,
      kind: target === sourceName ? 'update' : 'create',
      summary: `eslint() from pawl; the old config is kept as ${backup}`,
      apply: () => {
        renameSync(sourcePath, join(root, backup))
        writeText(join(root, target), ESLINT_CONFIG)
      }
    })
  } else {
    notes.push(`${sourceName} is unchanged. Export eslint() from ${PACKAGE_NAME} in it to put ESLint under the policy.`)
  }

  actions.push({
    path: MIGRATION_REPORT,
    kind: 'create',
    summary: 'what was carried over and what was not',
    apply: () => writeText(join(root, MIGRATION_REPORT), reportFile(summary, backup))
  })

  if (biomeOptions.length > 0)
    notes.push(
      `${plural(biomeOptions.length, 'rule')} had options that only ESLint and Oxlint take. Where Biome is the linter it uses its own. See ${MIGRATION_REPORT}.`
    )

  if (notEnforced.length > 0)
    notes.push(`${plural(notEnforced.length, 'rule or pack')} cannot run yet. See ${MIGRATION_REPORT}.`)

  return { ...summary, actions }
}

/** The lines `pawl migrate` prints before it asks to go ahead. */
export const describeMigration = (plan: MigratePlan): string[] => {
  const stricter = plan.changed.filter(change => rank(change.kept) > rank(change.standard)).length
  const rows: [number, string][] = [
    [plan.total, 'rules on in the old config'],
    [plan.same, 'already at the same level in the pawl standard and its packs'],
    [
      plan.changed.length,
      `kept at the old level (${stricter} stricter than the standard, ${plan.changed.length - stricter} looser)`
    ],
    [plan.formatting.length, 'formatting rules, now done by the formatter'],
    [plan.importSorting.length, 'import ordering rules, now done by import sorting'],
    [plan.added.length, 'rules the standard adds (their existing findings go to the baseline)']
  ]
  const width = Math.max(...rows.map(([count]) => String(count).length))
  const style = Object.entries(plan.policy.style ?? {}).map(([key, value]) => `${key}: ${String(value)}`)

  return [
    `Read   ${plan.source} (${plural(plan.samples.length, 'sample file')})`,
    '',
    ...rows.map(([count, text]) => `  ${String(count).padStart(width)}  ${text}`),
    '',
    ...(plan.packs.length > 0 ? [`Packs  ${plan.packs.join(', ')}`] : []),
    ...(style.length > 0 ? [`Style  ${style.join(', ')}`] : []),
    ...plan.actions.map(
      action => `${action.kind === 'create' ? 'Write ' : 'Update'} ${action.path}  (${action.summary})`
    )
  ]
}
