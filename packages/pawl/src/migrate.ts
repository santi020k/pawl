import { existsSync, readFileSync, realpathSync, renameSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allTechnologies, detect } from './detect.ts'
import { eslintPlan, importFromProject, importVia, packPreset, pluginPreset } from './engines/eslint.ts'
import { listFiles, readJson, writeText } from './fs-utils.ts'
import { ALWAYS_IGNORED, DEFAULT_IGNORES, WALK_SKIP } from './ignores.ts'
import { ESLINT_CONFIG, type InitAction, policyFile } from './init.ts'
import { getPack, PACKS, type Pack } from './packs.ts'
import { effectiveRules, findConfigFile, resolvePolicy, resolveSpecifier } from './policy.ts'
import { canonicalName, defaultLevel, getRule, type RuleDef } from './rules.ts'
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
  /** A policy to build on: a package name or a relative path. Only what differs from it is carried over. */
  extends?: string
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
  /**
   * Rules the old config had looser than the policy this one extends. Moving onto a policy means
   * taking its levels, so they stay at the policy's level (`standard`) and the old level (`kept`)
   * is not written. A stricter level is still carried over.
   */
  policyKept: RuleChange[]
  /** The package of the policy this one extends, for the install. Not set for a path. */
  policyPackage?: string
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

const readPrettier = (root: string): PrettierOptions | undefined =>
  readJson<PrettierOptions>(join(root, '.prettierrc')) ??
  readJson<PrettierOptions>(join(root, '.prettierrc.json')) ??
  readJson<{ prettier?: PrettierOptions }>(join(root, 'package.json'))?.prettier

const indentOf = (value: unknown): StyleOptions['indent'] | undefined => {
  if (value === 'tab') return 'tab'

  return value === 2 || value === 4 ? value : undefined
}

const commasOf = (value: unknown): StyleOptions['trailingCommas'] | undefined => {
  const setting = typeof value === 'object' && value !== null ? (value as { arrays?: unknown }).arrays : value

  if (typeof setting !== 'string') return undefined

  return setting === 'never' || setting === 'none' ? 'none' : 'all'
}

/**
 * Read the formatting style out of the old formatting rules, then out of a Prettier config when
 * there is one. `base` is the style the policy starts from.
 */
const styleFrom = (root: string, formatting: RuleMap, base: StyleOptions): Partial<StyleOptions> => {
  const style: { [Key in keyof StyleOptions]?: StyleOptions[Key] | undefined } = {}
  const option = (short: string): unknown => first(formatting, short)?.options[0]
  const quotes = option('quotes')
  const semi = first(formatting, 'semi')
  const maxLen = option('max-len')
  const arrow = option('arrow-parens')
  const prettier = readPrettier(root)

  if (quotes === 'single' || quotes === 'double') style.quotes = quotes

  if (semi) style.semicolons = semi.options[0] !== 'never'

  style.indent = indentOf(option('indent'))
  style.trailingCommas = commasOf(option('comma-dangle'))
  style.lineWidth = typeof maxLen === 'number' ? maxLen : (maxLen as { code?: number } | undefined)?.code

  if (arrow === 'as-needed' || arrow === 'always') style.arrowParens = arrow

  if (prettier) {
    if (prettier.singleQuote !== undefined) style.quotes = prettier.singleQuote ? 'single' : 'double'

    if (prettier.semi !== undefined) style.semicolons = prettier.semi

    if (prettier.useTabs) style.indent = 'tab'
    else style.indent = indentOf(prettier.tabWidth) ?? style.indent

    style.trailingCommas = commasOf(prettier.trailingComma) ?? style.trailingCommas
    style.lineWidth = prettier.printWidth ?? style.lineWidth

    if (prettier.arrowParens === 'always') style.arrowParens = 'always'
    else if (prettier.arrowParens === 'avoid') style.arrowParens = 'as-needed'
  }

  // Only what differs from the standard is worth writing down.
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => value !== undefined && value !== base[key as keyof StyleOptions])
  ) as Partial<StyleOptions>
}

/** The defaults with a wildcard, such as `*.tsbuildinfo`, as tests for one file or folder name. */
const COVERED_GLOBS = [...COVERED]
  .filter(name => name.includes('*'))
  .map(name => new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`))

/**
 * Whether pawl already skips what an old ignore pattern names. A default such as `dist` matches at
 * any depth, so a pattern with that name as one of its segments adds nothing: `packages/a/**\/dist`,
 * one copy for each workspace, is the usual case.
 */
const isCovered = (pattern: string): boolean =>
  pattern.split('/').some(segment => COVERED.has(segment) || COVERED_GLOBS.some(glob => glob.test(segment)))

/**
 * The old ignore patterns worth writing down: each one once, without those the defaults cover, and
 * without a copy for one workspace (`apps/web/**\/generated`) of a pattern for every folder (`**\/generated`).
 */
export const keptIgnores = (patterns: readonly string[]): string[] => {
  const kept = [
    ...new Set(
      patterns
        .map(pattern => pattern.replace(/\/\*\*(\/\*)?$/, '').replace(/\/$/, ''))
        .filter(pattern => pattern.length > 0 && !isCovered(pattern))
    )
  ]
  const everywhere = new Set(kept.filter(pattern => pattern.startsWith('**/')))

  return kept.filter(pattern => {
    const at = pattern.indexOf('/**/')

    return at <= 0 || !everywhere.has(pattern.slice(at + 1))
  })
}

/**
 * The folders the old config skips everywhere, read from its global `ignores`. Node imports a
 * TypeScript config by itself as long as its syntax is erasable; one it cannot import is not read.
 */
const readIgnores = async (file: string): Promise<string[] | undefined> => {
  if (!/\.[cm]?[jt]s$/.test(file)) return undefined

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

    return keptIgnores(patterns)
  } catch {
    return undefined
  }
}

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/** Package names that are an ESLint shared config or plugin. */
const LINT_PACKAGE = /eslint-(config|plugin)|^typescript-eslint$/

/** How many shared configs deep to look: a config that extends a config that brings the plugin, and a little more. */
const ROOT_DEPTH = 4

/** The real folder of a package as a folder sees it: its own node_modules first, then each one above. */
const packageDir = (name: string, from: string): string | undefined => {
  let dir = from

  while (!existsSync(join(dir, 'node_modules', name, 'package.json'))) {
    const parent = dirname(dir)

    if (parent === dir) return undefined

    dir = parent
  }

  try {
    // pnpm links a package into node_modules. Its own dependencies sit beside the real folder.
    return realpathSync(join(dir, 'node_modules', name))
  } catch {
    return undefined
  }
}

/**
 * The folders of the shared configs and plugins the old setup lints with, nearest first. A project
 * that takes its rules from a shared config often does not list the plugins: they are that config's
 * dependencies, and with pnpm only the config can load them. The comparison looks there too.
 */
export const sharedConfigRoots = (root: string): string[] => {
  const found = new Set<string>()
  let level = [root]

  for (let depth = 0; depth < ROOT_DEPTH && level.length > 0; depth++) {
    const next: string[] = []

    for (const dir of level) {
      const manifest = readJson<Manifest>(join(dir, 'package.json'))
      const names = Object.keys({
        ...manifest?.dependencies,
        ...(depth === 0 ? manifest?.devDependencies : {}),
        ...manifest?.peerDependencies,
        ...manifest?.optionalDependencies
      })

      for (const name of names.filter(candidate => LINT_PACKAGE.test(candidate))) {
        const target = packageDir(name, dir)

        if (!target || found.has(target)) continue

        found.add(target)
        next.push(target)
      }
    }

    level = next
  }

  return [...found]
}

/** How many rules of a preset the old config has to share, at the same level, to count as following it. */
const PRESET_MATCHES = 20

/**
 * How the old config relates to a pack whose plugin it uses: the pack as it is (`plain`), the pack
 * started from the plugin's own recommended preset (`recommended`), or not at all (`none`).
 */
const packFit = async (
  root: string,
  pluginRoots: readonly string[],
  pack: Pack,
  rules: RuleMap
): Promise<'plain' | 'recommended' | 'none'> => {
  // A base pack brings a whole preset with it. A few rules of its plugin do not call for that.
  const isBase = pack.auto !== undefined

  if (pack.preset && !isBase) return 'plain'

  const plugin = (await importVia(root, pluginRoots, pack.plugin)).module

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

/** The patterns of a legacy config's .eslintignore file. */
const readLegacyIgnores = (root: string): string[] => {
  const file = join(root, '.eslintignore')

  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\//, '').replace(/\/$/, ''))
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('!') && !isCovered(line))
}

/** The package a specifier names: `@acme/policy/strict` is in `@acme/policy`. */
const packageOf = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/')

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
    ...(plan.policyKept.length > 0
      ? [
          "## Kept at the policy's level",
          '',
          'The old config had these looser. The policy this repo now extends decides their level, so they are not in the policy file. Unless the policy locks a rule, you can still loosen it under `rules`.',
          '',
          '| Rule | Policy | Old config |',
          '| --- | --- | --- |',
          ...plan.policyKept.map(change => `| \`${change.rule}\` | ${change.standard} | ${change.kept} |`),
          ''
        ]
      : []),
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
export const planMigrate = async ({
  root,
  keepConfig = false,
  extends: parent
}: MigrateOptions): Promise<MigratePlan> => {
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
  /** What every policy of this migration starts from: the standard, or the policy it extends. */
  const base: PolicyInput = parent === undefined ? {} : { extends: parent }
  const policyPackage = parent === undefined || /^[./]/.test(parent) ? undefined : packageOf(parent)

  if (parent !== undefined && policyPackage) {
    try {
      resolveSpecifier(parent, policyPath)
    } catch (cause) {
      throw new Error(
        `Cannot find the policy "${parent}" from this project. Install ${policyPackage} here first, then migrate again.`,
        { cause }
      )
    }
  }

  const basePolicy = await resolvePolicy(base, policyPath)
  const locked = new Set(basePolicy.locked)
  const pluginRoots = sharedConfigRoots(root)
  /** What pawl would hand ESLint for a policy, were ESLint the only linter, loading plugins from these folders too. */
  const planFor = async (input: PolicyInput, roots: readonly string[]): ReturnType<typeof eslintPlan> =>
    eslintPlan({
      root,
      policy: await resolvePolicy(input, policyPath),
      biomeActive: false,
      ...context,
      pluginRoots: roots
    })
  /** Resolve the rules of a policy with the plugins the old config had, its shared configs' own included. */
  const pawlSide = async (input: PolicyInput): Promise<Side> => {
    const plan = await planFor(input, pluginRoots)

    if (!Flat) throw new Error(`ESLint ${major} cannot load a flat config`)

    const eslint = new Flat({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })

    return resolveSide(
      eslint,
      old.samples.map(file => [file]),
      core
    )
  }

  // Packs: one for every plugin the old config has rules on from.
  const prefixes = new Set(on(old.rules).map(name => splitName(name).prefix))
  const packs: string[] = []
  const namedPacks: string[] = []

  for (const pack of PACKS.filter(candidate => prefixes.has(candidate.prefix))) {
    const fit = await packFit(root, pluginRoots, pack, old.rules)

    if (fit === 'none') continue

    const entry = fit === 'recommended' ? `${pack.name}/recommended` : pack.name

    packs.push(entry)

    if (basePolicy.packs.includes(entry)) continue

    // A pack whose trigger the project depends on switches on by itself and needs no line in the policy.
    if (entry !== pack.name || !pack.when.some(name => detection.dependencies.includes(name))) namedPacks.push(entry)
  }

  let standard: Side = { rules: new Map(), formatting: new Map(), samples: [] }
  let comparable = true

  try {
    standard = await pawlSide({ ...base, packs })
  } catch (cause) {
    comparable = false
    notes.push(
      `Could not resolve the pawl standard through ESLint (${(cause as Error).message.split('\n')[0]}). Every plugin rule that is on was carried over as is.`
    )
  }

  const effective = effectiveRules(await resolvePolicy({ ...base, packs }, policyPath), context)
  const rules: Record<string, Level> = {}
  const changed: RuleChange[] = []
  const policyKept: RuleChange[] = []
  const importSorting: string[] = []
  const catalog = new Map<string, Level>()
  let same = 0
  /** Carry a level that differs, unless there is a policy to extend and the old level is looser than its level. */
  const keep = (rule: string, standardLevel: Level, kept: Level): void => {
    const name = canonicalName(rule)
    // The floor of a locked rule, as pawl works it out when it merges the policies.
    const floor = locked.has(name) ? (basePolicy.rules[name] ?? defaultLevel(name, basePolicy.strict)) : standardLevel

    if (parent !== undefined && rank(kept) < rank(floor)) {
      policyKept.push({ rule, standard: floor, kept })

      return
    }

    rules[rule] = kept
    changed.push({ rule, standard: standardLevel, kept })
  }

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

    keep(name, pawlLevel, level)
  }

  for (const [name, level] of catalog) {
    const pawlLevel = effective.get(name) ?? 'off'

    if (level === pawlLevel) {
      if (level !== 'off') same += 1

      continue
    }

    keep(name, pawlLevel, level)
  }

  const added = [
    ...[...effective].flatMap(([name, level]) =>
      level !== 'off' && !catalog.has(name) && !name.startsWith('pawl/') ? [name] : []
    ),
    ...on(standard.rules).filter(name => !catalogRule(name) && !old.rules.has(name))
  ].sort()

  changed.sort((a, b) => a.rule.localeCompare(b.rule))
  policyKept.sort((a, b) => a.rule.localeCompare(b.rule))

  const style = styleFrom(root, old.formatting, basePolicy.style)
  const ignore = (legacyName ? readLegacyIgnores(root) : await readIgnores(sourcePath))?.filter(
    pattern => !basePolicy.ignore.includes(pattern)
  )
  const policy: PolicyInput = {
    ...base,
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
    // What cannot run is asked of the project alone. A plugin that only the old shared config
    // brings is gone once that config is, so the project has to install it.
    const alone = await planFor({ ...policy, packs }, [])

    // Only what the migration brought in: the standard's own gaps are for "pawl doctor" to report.
    const packTitles = new Set(packs.map(entry => `The ${getPack(entry)?.title} pack`))

    notEnforced = alone.notEnforced.filter(item => item.rule in rules || packTitles.has(item.rule))

    for (const [name, resolved] of old.rules) {
      const mine = final.rules.get(name)
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
    policyKept,
    ...(policyPackage ? { policyPackage } : {}),
    formatting,
    importSorting: importSorting.sort(),
    packs,
    biomeOptions: biomeOptions.sort(),
    notEnforced
  }
  const carried = [
    parent === undefined ? '' : `extends ${parent}`,
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

  if (policyKept.length > 0)
    notes.push(
      `${plural(policyKept.length, 'rule')} the old config had looser ${policyKept.length === 1 ? 'stays' : 'stay'} at the level ${parent} gives ${policyKept.length === 1 ? 'it' : 'them'}. See ${MIGRATION_REPORT}.`
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
    ...(plan.policyKept.length > 0
      ? [[plan.policyKept.length, "looser in the old config, now at the policy's level"] satisfies [number, string]]
      : []),
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
