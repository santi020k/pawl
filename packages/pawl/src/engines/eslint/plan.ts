import { readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative as relativePath } from 'node:path'
import { IMPORTS_RULE, importRestrictions, SYNTAX_RULE, syntaxRestrictions } from '../../catalog/guards.ts'
import { PACKS, type Pack } from '../../catalog/packs.ts'
import { canonicalName, getRule, isGated, notFor, scopedRule, type Technology } from '../../catalog/rules.ts'
import { extraGlobals, ownGlobals, RUNTIME_GLOBALS } from '../../catalog/runtimes.ts'
import { effectiveRules, overrideRules } from '../../policy/levels.ts'
import { findProjectRoot } from '../../policy/load.ts'
import { loadProject } from '../../policy/project.ts'
import { testRunnerFiles } from '../../policy/test-runners.ts'
import { ESLINT_CONFIG_FILES, OXLINT_CONFIG_FILES, PAWL_CONFIG_FILES } from '../../project/config-files.ts'
import { allTechnologies, packageTechnologies, technologies as repoTechnologies } from '../../project/detect.ts'
import {
  ALWAYS_IGNORED,
  allIgnores,
  literalBrackets,
  makeIgnore,
  orderedEngineScopes,
  toEngineGlob,
  toEslintIgnores
} from '../../project/ignores.ts'
import { type Policy, type Runtime } from '../../types.ts'
import { isRecord } from '../../utils/json.ts'
import { toList } from '../../utils/list.ts'
import { oxlintCovers, tsgolintInstalled } from '../oxlint/config.ts'
import {
  follow,
  importFromProject,
  importRulePlugin,
  importVia,
  type Loaded,
  needs,
  pluginPackage,
  pluginPreset,
  presetOf,
  presetRules,
  type Rules,
  type RuleValue,
  TS_PREFIX
} from './load.ts'

/** An ESLint flat config object. Typed loosely so pawl does not depend on ESLint's types. */
export type FlatConfig = Record<string, unknown>

const SCRIPT_FILES = ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}']

/**
 * The globals of the runtimes the code runs in: from the project's `globals` package when it has
 * one, else pawl's own short list. ESLint knows none by itself, so without a list its own
 * `no-undef` would flag `console` and `window`.
 */
const globalsFor = async (root: string, runtimes: readonly Runtime[]): Promise<Record<string, unknown>> => {
  const { module: all } = await importFromProject(root, 'globals')
  const keys = [...new Set(runtimes.flatMap(runtime => RUNTIME_GLOBALS[runtime].globals))]
  const extra = Object.fromEntries(extraGlobals(runtimes).map(name => [name, 'readonly']))

  if (all && keys.every(key => isRecord(all[key]))) {
    return Object.assign({}, ...keys.map(key => all[key]), extra) as Record<string, unknown>
  }

  return Object.fromEntries(ownGlobals(runtimes).map(name => [name, 'readonly']))
}

const TS_FILES = ['**/*.{ts,mts,cts,tsx}']

/**
 * The packs whose preset's parser hands each `<script>` to `parserOptions.parser`, which reads
 * JavaScript only unless the config names another. In a TypeScript project they get typescript-eslint's.
 */
const SCRIPT_HOSTS: ReadonlySet<string> = new Set(['vue', 'svelte'])

/**
 * The packs whose parser reads the scripts of a component: a `.vue`, `.svelte` or `.astro` file.
 * The standard's rules for scripts reach those scripts through it.
 */
const COMPONENT_HOSTS: ReadonlySet<string> = new Set(['vue', 'svelte', 'astro'])

/**
 * Rules of a pack's plugin that are the same check as a rule of the standard, by the standard's
 * rule, in the files Biome lints. Where Biome is the linter and runs that rule, they are off in
 * those files, so a finding is not reported twice. Biome's noDuplicateObjectKeys reads JSON too,
 * but not JSON5.
 */
const BIOME_TWINS: Readonly<Record<string, { files: string[]; rules: Record<string, string> }>> = {
  jsonc: { files: ['**/*.{json,jsonc}'], rules: { 'jsonc/no-dupe-keys': 'no-dupe-keys' } }
}

export interface EslintPlan {
  config: FlatConfig[]
  /** Rules left to Biome because it enforces them faster. */
  coveredByBiome: string[]
  /** Rules and packs that are wanted but cannot run, and the plugin each one needs. */
  notEnforced: Array<{ rule: string; needs: string; required?: boolean }>
  /** Packs that are switched on. */
  activePacks: string[]
  /** Packs that fit what the project depends on, but whose plugin is not installed. */
  availablePacks: string[]
}

export interface EslintIntegrationOptions {
  /** Existing shared/framework configuration. Pawl replays locked rule floors after these blocks. */
  baseConfig?: readonly unknown[]
  /** Positive processor-output globs below a non-script host filename, such as `**\/*.vue/**`. */
  untypedFiles?: readonly string[]
  /** Explicit file ownership for optional packs, relative to root. */
  packFiles?: Readonly<Record<string, readonly string[]>>
}

export interface EslintPlanOptions extends EslintIntegrationOptions {
  root: string
  policy: Policy
  /** Biome is the linter, so ESLint only takes what Biome has no equivalent for. */
  biomeActive: boolean
  /** Oxlint is the linter, so ESLint only takes what Oxlint does not enforce. */
  oxlintActive?: boolean
  /** oxlint-tsgolint can run, so Oxlint enforces the rules that need type information too. */
  oxlintTypeAware?: boolean
  typescript: boolean
  /** The technologies the project uses. Rules for any other technology are left out. */
  technologies?: readonly Technology[]
  /** Every dependency in the repo, used to switch packs on. */
  dependencies?: readonly string[]
  /** Where the code runs, for the globals ESLint knows. Node and the browser when not given. */
  runtimes?: readonly Runtime[]
  /**
   * More folders to look for a plugin in when the project root does not have it. `migrate` names the
   * shared configs the old setup got its plugins from, so the comparison sees the same plugins.
   */
  pluginRoots?: readonly string[]
  /** Explicit plugin implementations, keyed by the ESLint namespace to register. */
  plugins?: Readonly<Record<string, unknown>>
  /** Patterns to skip that detection found, such as the target folder of a Rust project. */
  ignores?: readonly string[]
  /**
   * The technologies the whole repo uses. A rule for any other technology in `technologies`
   * runs only in the packages that use it. Defaults to `technologies`.
   */
  sharedTechnologies?: readonly Technology[]
  /** For a monorepo: each package's own technologies and dependencies, by package directory. */
  packages?: Record<string, PackageScope>
  /** The dependencies of the root package.json. A pack the root needs is repo-wide. */
  rootDependencies?: readonly string[]
}

/** What one package of a monorepo uses beyond the rest of the repo. */
export interface PackageScope {
  technologies: readonly Technology[]
  dependencies: readonly string[]
}

/**
 * File patterns limited to one folder: `**\/*.ts` in apps/web is `apps/web/**\/*.ts`. A pattern
 * already in that folder stays as it is, and one in another of `dirs` is left out.
 */
const within = (files: readonly unknown[], dir: string, dirs: readonly string[] = []): unknown[] =>
  files.flatMap((file): unknown[] => {
    // A list inside `files` means every pattern in it must match, so the folder joins it.
    if (typeof file !== 'string') return [[`${literalBrackets(dir)}/**`, ...toList(file as string | readonly string[])]]

    const pattern = file.replace(/^\.?\//, '')

    if (pattern.startsWith(`${literalBrackets(dir)}/`)) return [pattern]
    if (pattern.startsWith(`${dir}/`)) return [`${literalBrackets(dir)}/${pattern.slice(dir.length + 1)}`]

    return dirs.some(other => pattern.startsWith(`${other}/`) || pattern.startsWith(`${literalBrackets(other)}/`))
      ? []
      : [`${literalBrackets(dir)}/${pattern}`]
  })

/**
 * The packages a pack is for, when only some packages of a monorepo depend on what it is for.
 * Undefined means the whole repo: the policy named it, the root depends on it, or it has its own files.
 */
const packDirs = (
  pack: Pack,
  reason: 'named' | 'auto' | 'suggested',
  options: EslintPlanOptions
): string[] | undefined => {
  const packages = Object.entries(options.packages ?? {})

  if (reason !== 'suggested' || pack.spread || packages.length === 0) return undefined

  if (pack.when.some(name => (options.rootDependencies ?? []).includes(name))) return undefined

  const dirs = packages.flatMap(([dir, scope]) =>
    pack.when.some(name => scope.dependencies.includes(name)) ? [dir] : []
  )

  return dirs.length > 0 ? dirs : undefined
}

/**
 * Move the rules for a technology only some packages use into blocks for those packages, so
 * React rules run in the React app and not in the Vue one next to it. Biome does the same with
 * a biome.json per package.
 */
const scopeTechnologies = (config: FlatConfig[], options: EslintPlanOptions): FlatConfig[] => {
  const packages = Object.entries(options.packages ?? {})

  if (packages.length === 0) return config

  const shared = options.sharedTechnologies ?? options.technologies ?? []
  const dirs = packages.map(([dir]) => dir)
  const usedIn = (technology: Technology): string[] =>
    packages.flatMap(([dir, scope]) => (scope.technologies.includes(technology) ? [dir] : []))
  const scoped: FlatConfig[] = []

  for (const block of config) {
    if (!isRecord(block.rules)) {
      scoped.push(block)

      continue
    }

    // A copy: the block may be a preset the plugin exports, which is not pawl's to change.
    const kept: Rules = { ...block.rules }
    const moved = new Map<string, Rules>()

    scoped.push({ ...block, rules: kept })

    for (const [name, value] of Object.entries(block.rules)) {
      const tag = getRule(name)?.tag

      if (!tag || !isGated(tag) || shared.includes(tag)) continue

      delete kept[name]

      for (const dir of usedIn(tag)) moved.set(dir, { ...moved.get(dir), [name]: value })
    }

    for (const [dir, rules] of moved) {
      const { name, files, ignores, plugins, languageOptions } = block
      // A block a pack already gave to some packages keeps to them.
      const scopedFiles = within(Array.isArray(files) ? files : ['**'], dir, dirs)

      if (scopedFiles.length === 0) continue

      scoped.push({
        name: `${typeof name === 'string' ? name : 'pawl/block'}/${dir}`,
        files: scopedFiles,
        ignores: [
          ...(Array.isArray(ignores) ? ignores : []),
          ...dirs.filter(child => child.startsWith(`${dir}/`)).map(child => `${literalBrackets(child)}/**`)
        ],
        ...(plugins ? { plugins } : {}),
        ...(languageOptions ? { languageOptions } : {}),
        rules
      })
    }
  }

  return scoped
}

const splitRule = (name: string): string | undefined => {
  const slash = name.lastIndexOf('/')

  return slash === -1 ? undefined : name.slice(0, slash)
}

/** The policy's entry for a pack: its name, or its name and one of the plugin's own presets (`unicorn/recommended`). */
const entryFor = (packs: readonly string[], pack: Pack): string | undefined =>
  packs.find(entry => entry === pack.name || entry.startsWith(`${pack.name}/`))

/** A pack is wanted when the policy names it, the project depends on what it is for, or ESLint is the linter. */
const wants = (pack: Pack, options: EslintPlanOptions): 'named' | 'auto' | 'suggested' | undefined => {
  if (entryFor(options.policy.packs, pack)) return 'named'

  const eslintLints = !options.biomeActive && options.oxlintActive !== true

  if (pack.auto === 'linter' && eslintLints) return 'auto'

  if (pack.auto === 'linter-ts' && eslintLints && options.typescript) return 'auto'

  return pack.when.some(name => (options.dependencies ?? []).includes(name)) ? 'suggested' : undefined
}

/** A pack that is on and has a block of its own in the config. */
interface PackBlock {
  pack: Pack
  plugin: Record<string, unknown>
  /** The rules that came from the plugin's own preset, which the installed plugin is sure to have. */
  fromPlugin: Set<string>
  /** The packages it runs in, when only some packages depend on what it is for. Undefined means the whole repo. */
  dirs: string[] | undefined
}

/** What the plan is built from and into, phase by phase. */
interface Build {
  options: EslintPlanOptions
  /** The fast linter already enforces this rule, so ESLint leaves it alone. */
  covered: (name: string) => boolean
  /** typescript-eslint, when the project has TypeScript. Its files need the parser even with no rule on. */
  ts: Loaded
  /** Every plugin loaded for a catalog rule, by its rule prefix. */
  plugins: Map<string, Loaded>
  coreRules: Rules
  pluginRules: Rules
  tsRules: Rules
  /** The rules of each active pack, by pack name. */
  packRules: Map<string, Rules>
  packBlocks: PackBlock[]
  needsTypes: boolean
  coveredByBiome: string[]
  notEnforced: EslintPlan['notEnforced']
  activePacks: string[]
  availablePacks: string[]
}

/** Load the plugin of every pack the project wants, and start each pack from its preset. */
const loadPacks = async (build: Build): Promise<void> => {
  const { options, ts, notEnforced, availablePacks, activePacks, coreRules, tsRules, packRules, packBlocks } = build
  const { root, policy, pluginRoots = [] } = options

  for (const pack of PACKS) {
    const reason = wants(pack, options)

    if (!reason) continue

    const supplied = options.plugins?.[pack.prefix]
    let loaded = ts
    if (pack.name !== 'typescript')
      loaded = supplied === undefined ? await importVia(root, pluginRoots, pack.plugin) : suppliedPlugin(supplied)

    if (!loaded.module) {
      // A plugin that is not installed only suggests its pack. One that is installed but cannot load
      // would have switched the pack on, so the check stops rather than pass without its rules.
      if (reason === 'suggested' && !loaded.error) availablePacks.push(pack.name)
      else
        notEnforced.push({
          rule: `The ${pack.title} pack`,
          needs: needs(pack.plugin, loaded),
          ...(entryFor(policy.packs, pack) === undefined && !loaded.error ? {} : { required: true })
        })

      continue
    }

    const entry = entryFor(policy.packs, pack)
    const chosen = entry !== undefined && entry !== pack.name ? entry.slice(pack.name.length + 1) : undefined
    const own = chosen === undefined ? undefined : pluginPreset(loaded.module, chosen, pack.prefix)

    if (chosen !== undefined && !own) {
      notEnforced.push({
        rule: `The ${pack.title} pack`,
        needs: `a preset named "${chosen}" in ${pack.plugin}`,
        required: true
      })

      continue
    }

    const preset = own ?? (pack.spread ? {} : presetRules(presetOf(pack, loaded.module)))
    const rules: Rules = { ...preset, ...pack.rules }

    activePacks.push(pack.name)

    if (pack.name === 'javascript') Object.assign(coreRules, rules)
    else if (pack.name === 'typescript') Object.assign(tsRules, rules)
    else {
      packRules.set(pack.name, rules)
      packBlocks.push({
        pack,
        plugin: loaded.module,
        fromPlugin: new Set(Object.keys(preset)),
        dirs: packDirs(pack, reason, options)
      })
    }

    build.needsTypes ||= pack.typeAware === true
  }
}

/** Give each catalog rule to the block that runs it: the base, TypeScript, a pack, or a plugin of its own. */
const placeRules = async (build: Build): Promise<void> => {
  const { options, covered, ts, plugins, coreRules, pluginRules, tsRules, packRules, packBlocks } = build
  const { coveredByBiome, notEnforced } = build
  const { root, policy, biomeActive, typescript, technologies = [], pluginRoots = [] } = options

  for (const [name, level] of effectiveRules(policy, { typescript, technologies })) {
    // Names another engine runs, and pawl's own rules, are not ESLint's to run.
    if (notFor(name, 'eslint')) continue

    const def = getRule(name)

    if (covered(name)) {
      if (level !== 'off') coveredByBiome.push(name)

      // The javascript and typescript packs start from presets that may turn it on in ESLint too.
      // A rule off only because the standard holds it back, as it does an unstable one, does not run
      // in the fast linter, so the preset's level stands unless the policy sets one.
      if (level === 'off' && def?.nursery === true && policy.rules[name] === undefined) continue

      for (const alias of [scopedRule(name, 'eslint') ?? name, ...(def?.aliases ?? [])]) {
        if (alias in coreRules) coreRules[alias] = 'off'
        if (alias in tsRules) tsRules[alias] = 'off'
      }

      continue
    }

    const eslintName = scopedRule(name, 'eslint') ?? name
    const ruleOptions = policy.options[name] ?? def?.options?.eslint
    const value: RuleValue = level !== 'off' && ruleOptions ? [level, ...ruleOptions] : level
    const prefix = splitRule(eslintName)
    // Two packs can share a plugin. The rule goes to the ones that already have it, else to the first.
    const withPrefix = packBlocks.flatMap(({ pack }) =>
      pack.prefix === prefix ? [packRules.get(pack.name) ?? {}] : []
    )
    const holders = withPrefix.filter(rules => eslintName in rules)
    const inPack = holders.length > 0 ? holders : withPrefix.slice(0, 1)

    // A rule the catalog holds back because Biome's version is unstable is stable in its ESLint
    // plugin, so the level a pack's preset gave it stands unless the policy sets one.
    if (level === 'off' && def?.nursery === true && policy.rules[name] === undefined) continue

    // A rule that is off only needs saying where a preset may have turned it on.
    if (level === 'off' && holders.length === 0 && !(eslintName in coreRules) && !(eslintName in tsRules)) continue

    // Where Biome lints, ESLint is only there for the packs. A catalog rule Biome has no equivalent
    // for runs when its plugin's pack is on or the policy names it; it does not ask for a plugin by itself.
    if (biomeActive && def && !def.biome && withPrefix.length === 0 && policy.rules[name] === undefined) continue

    if (!prefix) {
      coreRules[eslintName] = value

      // In TypeScript files the typescript-eslint twin of a core rule replaces it.
      const twin = def?.aliases?.find(alias => alias.startsWith(`${TS_PREFIX}/`))

      if (twin && ts.module && level !== 'off') {
        tsRules[eslintName] = 'off'
        tsRules[twin] = value
      }

      continue
    }

    if (prefix && inPack.length > 0) {
      for (const rules of inPack) rules[eslintName] = value

      continue
    }

    // The fast linters enforce this plugin's catalog rules natively; ESLint takes them with the pack.
    if (policy.rules[name] === undefined && PACKS.some(pack => pack.prefix === prefix && pack.withPack === true))
      continue

    // The plugin of a library the project does not use, such as Vitest's where the tests run on
    // Jest or node:test, is not asked for unless the policy names the rule. A rule for a technology,
    // such as React's, already applies only where the project uses it.
    if (policy.rules[name] === undefined && !(def && isGated(def.tag)) && !usesLibraryOf(prefix, options)) continue

    if (!plugins.has(prefix))
      plugins.set(
        prefix,
        options.plugins?.[prefix] === undefined
          ? await importRulePlugin(root, pluginRoots, prefix)
          : suppliedPlugin(options.plugins[prefix])
      )

    const loaded = plugins.get(prefix) as Loaded

    if (!loaded.module) {
      notEnforced.push({ rule: name, needs: needs(loaded.packageName ?? pluginPackage(prefix), loaded) })

      continue
    }

    if (lacks(loaded, eslintName, prefix)) {
      notEnforced.push({ rule: name, needs: `a version of ${loaded.packageName ?? pluginPackage(prefix)} that has it` })

      continue
    }

    if (prefix === TS_PREFIX) {
      tsRules[eslintName] = value
      build.needsTypes ||= def?.typeAware === true
    } else {
      pluginRules[eslintName] = value
    }
  }
}

/**
 * False when the rules of a plugin are for a library the project does not use: its pack switches on
 * for some dependencies, the project has none of them, and the policy declares no test runner of
 * that name.
 */
const usesLibraryOf = (prefix: string, { policy, dependencies = [] }: EslintPlanOptions): boolean => {
  const packs = PACKS.filter(pack => pack.prefix === prefix && pack.when.length > 0)
  const runners: Readonly<Record<string, unknown>> = policy.testRunners

  return (
    packs.length === 0 ||
    packs.some(pack => pack.when.some(name => dependencies.includes(name)) || runners[pack.name] !== undefined)
  )
}

/** The plugin in use lists its rules, and not this one: ESLint would refuse the config. */
const lacks = (loaded: Loaded, rule: string, prefix: string): boolean =>
  isRecord(loaded.module?.rules) && !(rule.slice(prefix.length + 1) in loaded.module.rules)

/** The guards: imports and code patterns to stay away from, for the libraries the project uses. */
const applyGuards = ({ options, coreRules, coveredByBiome }: Build): void => {
  const { policy, biomeActive } = options

  const imports = importRestrictions(policy, options.dependencies)
  // Biome runs the guards' code patterns as pawl's own rules, so ESLint keeps only the project's.
  const syntax = syntaxRestrictions(policy, options.dependencies, { guards: !biomeActive })

  // Biome and Oxlint both restrict imports themselves.
  if (imports && (biomeActive || options.oxlintActive === true)) {
    delete coreRules[IMPORTS_RULE]
    coveredByBiome.push(IMPORTS_RULE)
  } else if (imports) coreRules[IMPORTS_RULE] = [imports.level, imports.eslint]

  if (syntax) coreRules[SYNTAX_RULE] = [syntax.level, ...syntax.options]
}

/** Options the policy sets for rules whose level comes from a pack or a preset. */
const applyOptions = ({ options, coreRules, pluginRules, tsRules, packRules }: Build): void => {
  const { policy } = options
  const remainingOptions: Record<string, unknown[]> = { ...policy.options }

  // The two rules the guards build themselves take their options there.
  for (const name of [IMPORTS_RULE, SYNTAX_RULE]) delete remainingOptions[name]

  for (const rules of [coreRules, pluginRules, tsRules, ...packRules.values()]) {
    for (const [name, ruleOptions] of Object.entries(remainingOptions)) {
      const current = rules[name]
      const severity: unknown = Array.isArray(current) ? current[0] : current

      if (current !== undefined && severity !== 'off' && severity !== 0) rules[name] = [severity, ...ruleOptions]
    }
  }
}

/** The ignores, the base block for scripts and the TypeScript block. */
const baseConfigs = async (build: Build): Promise<FlatConfig[]> => {
  const { options, ts, plugins, coreRules, pluginRules, tsRules, notEnforced } = build
  const { root, policy, typescript } = options

  // The defaults, the root .gitignore and the policy's own patterns, in that order, as pawl reads them.
  const ignores = [
    ...new Set([
      ...ALWAYS_IGNORED.map(dir => `**/${dir}/**`),
      ...allIgnores(root, policy, options.ignores).flatMap(toEslintIgnores)
    ])
  ]
  const config: FlatConfig[] = [{ name: 'pawl/ignores', ignores }]
  const tseslint = ts.module
  const globals = await globalsFor(root, options.runtimes ?? ['node', 'browser'])
  const otherPlugins = Object.fromEntries(
    [...plugins].flatMap(([prefix, loaded]) => (prefix !== TS_PREFIX && loaded.module ? [[prefix, loaded.module]] : []))
  )

  config.push({
    name: 'pawl/base',
    files: SCRIPT_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    ...(Object.keys(otherPlugins).length > 0 ? { plugins: otherPlugins } : {}),
    rules: { ...coreRules, ...pluginRules }
  })

  if (tseslint) {
    config.push({
      name: 'pawl/typescript',
      files: TS_FILES,
      languageOptions: {
        ...(tseslint.parser ? { parser: tseslint.parser } : {}),
        parserOptions: build.needsTypes ? { projectService: true, tsconfigRootDir: root } : {}
      },
      plugins: { [TS_PREFIX]: tseslint.plugin },
      rules: tsRules
    })
  } else if (typescript && !notEnforced.some(item => item.rule === 'The TypeScript pack')) {
    notEnforced.push({ rule: 'TypeScript files', needs: needs('typescript-eslint', ts) })
  }

  config.push(...componentConfigs(build, otherPlugins, globals))

  return config
}

/** The component files a pack's parser reads, within the files the integration gives the pack. */
const componentFiles = (pack: Pack, options: EslintPlanOptions): Array<string | string[]> => {
  const explicit = options.packFiles?.[pack.name]?.map(toEngineGlob)
  const own = pack.files ?? []

  return explicit ? own.flatMap(file => explicit.map(pattern => [file, pattern])) : own
}

/** The component files of the packs that are on, which ESLint reads through the framework's parser. */
const activeComponentFiles = (packs: readonly string[], options: EslintPlanOptions): Array<string | string[]> =>
  PACKS.filter(pack => COMPONENT_HOSTS.has(pack.name) && packs.includes(pack.name)).flatMap(pack =>
    componentFiles(pack, options)
  )

/** `@typescript-eslint/X` and the core rule it stands in for in TypeScript files. */
const coreTwin = (name: string): string | undefined =>
  name.startsWith(`${TS_PREFIX}/`) ? (getRule(name)?.name ?? name.slice(TS_PREFIX.length + 1)) : undefined

const isOff = (value: RuleValue): boolean => {
  const level: unknown = Array.isArray(value) ? value[0] : value

  return level === 'off' || level === 0
}

/**
 * The standard's rules for scripts, in the scripts of the components the framework packs read: the
 * same rules as a script, and in a TypeScript project those of a TypeScript file. The block names no
 * parser, so the pack's parser, which comes after it, reads the file, and the pack's own presets can
 * still turn off a core rule that misfires there. No TypeScript program reaches these files, so the
 * rules that need type information stay out, and a core rule their twin stood in for comes back.
 */
const componentConfigs = (
  { options, ts, coreRules, pluginRules, tsRules, activePacks }: Build,
  otherPlugins: Record<string, unknown>,
  globals: Record<string, unknown>
): FlatConfig[] => {
  const files = activeComponentFiles(activePacks, options)

  if (files.length === 0) return []

  const tseslint = ts.module
  const plugins: Record<string, unknown> = { ...otherPlugins, ...(tseslint ? { [TS_PREFIX]: tseslint.plugin } : {}) }
  const typescriptRules = tseslint ? tsRules : {}
  const typed = (name: string): boolean => needsTypeInformation(name, plugins)
  const standIns = new Set(
    Object.entries(typescriptRules).flatMap(([name, value]) =>
      typed(name) && !isOff(value) ? [coreTwin(name) ?? name] : []
    )
  )
  const rules: Rules = Object.fromEntries(
    Object.entries({ ...coreRules, ...pluginRules }).filter(([name]) => !typed(name))
  )

  for (const [name, value] of Object.entries(typescriptRules)) {
    if (typed(name) || (isOff(value) && standIns.has(name))) continue

    rules[name] = value
  }

  if (Object.keys(rules).length === 0) return []

  const used = Object.fromEntries(
    Object.entries(plugins).filter(([prefix]) => Object.keys(rules).some(name => splitRule(name) === prefix))
  )
  return [
    {
      name: 'pawl/components',
      files,
      languageOptions: { globals },
      ...(Object.keys(used).length > 0 ? { plugins: used } : {}),
      rules
    }
  ]
}

/** One block per active pack, with the rules the installed plugin has. */
const packConfigs = ({ covered, ts, packRules, packBlocks, notEnforced, options }: Build): FlatConfig[] => {
  const config: FlatConfig[] = []
  const { policy, typescript, technologies = [] } = options
  const levels = effectiveRules(policy, { typescript, technologies })
  // The fast linter runs a rule of the standard it has, unless the rule is off only because the
  // standard holds it back, as it does an unstable one: then the level a pack's preset gives it stands.
  const runsElsewhere = (name: string): boolean => {
    const canonical = canonicalName(name)

    return (
      covered(name) &&
      (levels.get(canonical) !== 'off' || getRule(canonical)?.nursery !== true || policy.rules[canonical] !== undefined)
    )
  }

  for (const { pack, plugin, fromPlugin, dirs } of packBlocks) {
    const rules = packRules.get(pack.name) ?? {}

    const known = isRecord(plugin.rules) ? plugin.rules : undefined

    for (const name of Object.keys(rules)) {
      // Where Biome is the linter, it keeps the rules it already enforces.
      if (covered(name)) rules[name] = 'off'

      // ESLint refuses a config that names a rule the installed plugin does not have.
      const missing =
        known !== undefined &&
        !fromPlugin.has(name) &&
        name.startsWith(`${pack.prefix}/`) &&
        !(name.slice(pack.prefix.length + 1) in known)

      if (missing) {
        const value = rules[name]
        const level: unknown = Array.isArray(value) ? value[0] : value

        if (level !== 'off' && level !== 0)
          notEnforced.push({
            rule: name,
            needs: `a version of ${pack.plugin} that has it`,
            ...(entryFor(options.policy.packs, pack) !== undefined || options.plugins?.[pack.prefix] !== undefined
              ? { required: true }
              : {})
          })

        delete rules[name]
      }
    }

    const explicitFiles = options.packFiles?.[pack.name]?.map(toEngineGlob)
    const files = explicitFiles ?? pack.files
    if (pack.spread) {
      const preset = toList(presetOf(pack, plugin) as FlatConfig | readonly FlatConfig[] | undefined)
      const blocks = preset.map(block => {
        if (Object.keys(block).every(key => key === 'ignores' || key === 'name')) return block
        // A block of the preset with no files would reach every file ESLint lints. One that sets a
        // parser, a language or a processor keeps to the pack's own files, or it would parse the
        // scripts as HTML. One with rules only keeps to the scripts and the pack's own files, away
        // from the Markdown, JSON or YAML another pack hands to its own language, where it crashes.
        if (!explicitFiles) {
          if (Array.isArray(block.files) || !pack.files) return block

          return { ...block, files: parses(block) ? pack.files : [...SCRIPT_FILES, ...pack.files] }
        }
        const original = Array.isArray(block.files) ? block.files : ['**/*']
        return {
          ...block,
          files: original.flatMap(file =>
            explicitFiles.map(pattern => [...(Array.isArray(file) ? file : [file]), pattern])
          )
        }
      })
      config.push(...blocks)
      // A rule of the preset the fast linter runs stays the fast linter's, as one the pack names does.
      // Only under its own name: another name the catalog files with it, such as vue/no-unused-vars
      // for the variables of a template, can check what the fast linter does not read.
      for (const [name, value] of Object.entries(presetRules(blocks)))
        if (!(name in rules) && !isOff(value) && getRule(name)?.name === name && runsElsewhere(name))
          rules[name] = 'off'
      // The preset's parser reads each <script> with parserOptions.parser, which is espree unless the
      // config names another, so a component with `lang="ts"` would not parse. The same goes for every
      // file the preset hands to that parser, such as Svelte's `.svelte.ts` modules.
      const scriptParser = SCRIPT_HOSTS.has(pack.name) ? ts.module?.parser : undefined
      const parsed = blocks.flatMap(block =>
        isRecord(block.languageOptions) && block.languageOptions.parser !== undefined && Array.isArray(block.files)
          ? (block.files as unknown[])
          : []
      )
      if (scriptParser !== undefined && parsed.length > 0)
        config.push({
          name: `pawl/pack/${pack.name}/typescript`,
          files: parsed,
          languageOptions: { parserOptions: { parser: scriptParser } }
        })
      // The plugin object the preset registers, which a plugin with both a CommonJS and an ES module
      // build may not share with the module pawl imported. ESLint refuses two objects under one name.
      const own = preset.map(block => (isRecord(block.plugins) ? block.plugins[pack.prefix] : undefined)).find(Boolean)
      config.push({
        name: `pawl/pack/${pack.name}`,
        ...(files ? { files } : {}),
        plugins: { [pack.prefix]: own ?? plugin },
        rules
      })
    } else {
      const parser = follow(plugin, pack.parser ?? [])
      const block: FlatConfig = {
        name: `pawl/pack/${pack.name}`,
        files: files ?? SCRIPT_FILES,
        ...(pack.ignores ? { ignores: pack.ignores } : {}),
        ...(pack.parser && parser ? { languageOptions: { parser } } : {}),
        plugins: { [pack.prefix]: plugin },
        rules
      }
      if (dirs) {
        for (const dir of dirs)
          config.push({
            ...block,
            name: dirs.length === 1 ? `pawl/pack/${pack.name}` : `pawl/pack/${pack.name}/${dir}`,
            files: within(files ?? SCRIPT_FILES, dir),
            ignores: [
              ...(pack.ignores ?? []),
              ...Object.keys(options.packages ?? {})
                .filter(child => child.startsWith(`${dir}/`))
                .map(child => `${literalBrackets(child)}/**`)
            ]
          })
      } else config.push(block)
    }

    // A check of the plugin that a rule of the standard Biome runs makes too, in the files Biome lints.
    const twins = BIOME_TWINS[pack.name]
    const biome = Object.entries(twins?.rules ?? {}).flatMap(([name, standard]) =>
      options.biomeActive && runsElsewhere(standard) ? [[name, 'off']] : []
    )
    if (twins && biome.length > 0)
      config.push({
        name: `pawl/pack/${pack.name}/biome`,
        files: explicitFiles ? twins.files.flatMap(file => explicitFiles.map(pattern => [file, pattern])) : twins.files,
        rules: Object.fromEntries(biome)
      })
  }

  return config
}

/** The policy's overrides. They go last, so they win over the base rules and the packs for the files they name. */
const overrideConfigs = async (build: Build): Promise<FlatConfig[]> => {
  const { options, covered, ts, plugins, packBlocks, notEnforced } = build
  const { root, policy, typescript, technologies = [], pluginRoots = [] } = options
  const config: FlatConfig[] = []
  const tseslint = ts.module
  const loadedPlugins = new Map<string, unknown>([
    ...[...plugins].flatMap(([prefix, loaded]): [string, unknown][] =>
      loaded.module ? [[prefix, prefix === TS_PREFIX ? tseslint?.plugin : loaded.module]] : []
    ),
    ...packBlocks.map(({ pack, plugin }): [string, unknown] => [pack.prefix, plugin])
  ])
  const packageNames = new Map<string, string>([
    ...[...plugins].flatMap(([prefix, loaded]): [string, string][] =>
      loaded.packageName ? [[prefix, loaded.packageName]] : []
    ),
    ...packBlocks.map(({ pack }): [string, string] => [pack.prefix, pack.plugin])
  ])
  const components = tseslint ? activeComponentFiles(build.activePacks, options) : []
  for (const [index, override] of policy.overrides.entries()) {
    const rules: Rules = {}
    const twins: Rules = {}
    const componentTwins: Rules = {}
    const used: Record<string, unknown> = {}
    const entries = overrideRules(override, { typescript, technologies }, policy)

    for (const [name, level] of entries) {
      if (notFor(name, 'eslint') || covered(name)) continue

      const def = getRule(name)
      const eslintName = scopedRule(name, 'eslint') ?? name
      const ruleOptions = override.options[name] ?? policy.options[name] ?? def?.options?.eslint
      const value: RuleValue = level !== 'off' && ruleOptions ? [level, ...ruleOptions] : level
      const prefix = splitRule(eslintName)

      if (prefix) {
        if (!loadedPlugins.has(prefix)) {
          const loaded =
            options.plugins?.[prefix] === undefined
              ? await importRulePlugin(root, pluginRoots, prefix)
              : suppliedPlugin(options.plugins[prefix])

          if (!loaded.module) {
            notEnforced.push({ rule: name, needs: needs(loaded.packageName ?? pluginPackage(prefix), loaded) })

            continue
          }

          loadedPlugins.set(prefix, loaded.module)
          if (loaded.packageName) packageNames.set(prefix, loaded.packageName)
        }

        const plugin = loadedPlugins.get(prefix)

        if (isRecord(plugin) && lacks({ module: plugin }, eslintName, prefix)) {
          notEnforced.push({
            rule: name,
            needs: `a version of ${packageNames.get(prefix) ?? pluginPackage(prefix)} that has it`
          })

          continue
        }

        used[prefix] = loadedPlugins.get(prefix)
      }

      rules[eslintName] = value

      // In TypeScript files the typescript-eslint twin of a core rule stands in for it, as in the base.
      const twin = prefix ? undefined : def?.aliases?.find(alias => alias.startsWith(`${TS_PREFIX}/`))

      if (twin && tseslint) {
        twins[eslintName] = 'off'
        twins[twin] = value

        // Component scripts have no TypeScript program: a twin that needs one leaves the core rule there.
        if (!needsTypeInformation(twin, { [TS_PREFIX]: tseslint.plugin })) {
          componentTwins[eslintName] = 'off'
          componentTwins[twin] = value
        }
      }
    }

    for (const [part, { files, excluded }] of orderedEngineScopes(override.files).entries()) {
      const suffix = part === 0 ? '' : `/${part}`
      const ignores = excluded.length > 0 ? { ignores: excluded } : {}
      if (Object.keys(rules).length > 0) {
        config.push({
          name: `pawl/override/${index}${suffix}`,
          files,
          ...ignores,
          ...(Object.keys(used).length > 0 ? { plugins: used } : {}),
          rules
        })
      }
      if (tseslint && Object.keys(twins).length > 0) {
        config.push({
          name: `pawl/override/${index}${suffix}/typescript`,
          files: files.map(glob => [glob, ...TS_FILES]),
          ...ignores,
          plugins: { [TS_PREFIX]: tseslint.plugin },
          rules: twins
        })
      }
      if (tseslint && components.length > 0 && Object.keys(componentTwins).length > 0) {
        config.push({
          name: `pawl/override/${index}${suffix}/components`,
          files: files.flatMap(glob => components.map(kind => [glob, ...toList(kind)])),
          ...ignores,
          plugins: { [TS_PREFIX]: tseslint.plugin },
          rules: componentTwins
        })
      }
    }
  }

  return config
}

/** A flat config block that decides how files are read: a parser, a language or a processor. */
const parses = (block: FlatConfig): boolean =>
  block.language !== undefined ||
  block.processor !== undefined ||
  (isRecord(block.languageOptions) && block.languageOptions.parser !== undefined)

/** Explicit aliases must provide real rule implementations, not just a matching namespace. */
const suppliedPlugin = (value: unknown): Loaded =>
  isRecord(value) ? { module: value } : { error: 'the supplied plugin must be an object' }

const validateSuppliedRules = (config: FlatConfig[], options: EslintPlanOptions, plan: EslintPlan): void => {
  const requestedPacks = new Set(
    PACKS.filter(pack => entryFor(options.policy.packs, pack) !== undefined).map(pack => pack.prefix)
  )
  const requestedRules = new Set([
    ...Object.keys(options.policy.rules),
    ...options.policy.overrides.flatMap(override => Object.keys(override.rules))
  ])
  // ESLint merges the plugins of every block that applies to a file, so a rule may name a plugin
  // another block registers. A plugin's own flat preset does that: one block registers the plugin,
  // and the blocks after it set its rules.
  const registeredAnywhere: Record<string, unknown> = {}

  for (const block of config) {
    if (!isRecord(block.plugins)) continue

    for (const [prefix, plugin] of Object.entries(block.plugins)) registeredAnywhere[prefix] ??= plugin
  }

  for (const block of config) {
    if (!isRecord(block.rules)) continue

    for (const [name, value] of Object.entries(block.rules)) {
      const prefix = splitRule(name)
      const supplied = prefix ? options.plugins?.[prefix] : undefined
      const own = prefix && isRecord(block.plugins) ? block.plugins[prefix] : undefined
      const registered = own ?? (prefix ? registeredAnywhere[prefix] : undefined)
      const plugin = supplied ?? registered
      const level: unknown = Array.isArray(value) ? value[0] : value

      if (
        !prefix ||
        (supplied === undefined && !requestedPacks.has(prefix) && !requestedRules.has(name)) ||
        level === 'off' ||
        level === 0
      )
        continue

      const rules = isRecord(plugin) && isRecord(plugin.rules) ? plugin.rules : {}
      const rule = rules[name.slice(prefix.length + 1)]

      if (isRecord(rule) && typeof rule.create === 'function') continue

      plan.notEnforced.push({ rule: name, needs: `a ${prefix} plugin implementing ${name}`, required: true })
      delete block.rules[name]
    }
  }

  for (const missing of plan.notEnforced) {
    if (requestedRules.has(missing.rule)) missing.required = true
  }
}

const configBlocks = (values: readonly unknown[]): FlatConfig[] =>
  values.map(value => {
    if (!isRecord(value)) throw new Error('baseConfig must contain ESLint flat config objects.')
    return value
  })

const PROCESSOR_FILES = ['**/?*.astro/**', '**/?*.md/**', '**/?*.mdx/**']

/**
 * The config files of pawl and of the linters it drives that are TypeScript. A project's tsconfig
 * often leaves them out, as Vite's and Svelte's templates do, and typescript-eslint's project service
 * cannot parse a file no tsconfig includes, so they are linted without a TypeScript program.
 */
const TOOL_CONFIG_FILES = [...PAWL_CONFIG_FILES, ...ESLINT_CONFIG_FILES, ...OXLINT_CONFIG_FILES]
  .filter(name => /\.[cm]?ts$/.test(name))
  .map(name => `**/${name}`)

/** Only a path below a non-script host filename may opt out of project-aware linting. */
const processorPattern = (pattern: string): { files: string; host: string } => {
  const parts = pattern.split('/')
  const invalid = (): never => {
    throw new Error(
      `untypedFiles pattern "${pattern}" must descend below a non-script processor host filename (for example **/*.vue/**). Physical, negative, alternative and traversal patterns are not supported.`
    )
  }

  if (!/^[\w.*?/-]+$/.test(pattern) || parts.some(part => part === '' || part === '.' || part === '..')) invalid()

  const host = parts.findIndex((part, index) => index < parts.length - 1 && /^.+\.[a-z][a-z0-9-]*$/i.test(part))
  if (host < 0) invalid()
  const segment = parts[host] ?? ''
  const extension = segment.slice(segment.lastIndexOf('.') + 1)
  if (/^(?:[cm]?[jt]sx?)$/i.test(extension)) invalid()

  // An extension alone is a directory such as .astro, not a processor host filename.
  parts[host] = segment.replace(/^\*+\./, '?*.')
  return { files: parts.join('/'), host: parts.slice(0, host + 1).join('/') }
}

/** Reject real host-shaped directories, including ignored or empty ones that could gain physical source later. */
const processorFiles = (root: string, extra: readonly string[]): string[] => {
  const patterns = [...PROCESSOR_FILES, ...extra].map(processorPattern)
  const matchesHost = patterns.map(({ host }) => makeIgnore([host]))
  const visited = new Set<string>()
  let scanned = 0
  const realRoot = realpathSync(root)
  const walk = (dir: string, relative: string, depth = 0): void => {
    if (depth > 64 || scanned++ >= 10_000)
      throw new Error(
        'Cannot verify processor output scopes within the directory scan limit. Narrow the project root before enabling this integration.'
      )
    const real = realpathSync(dir)
    const inside = relativePath(realRoot, real)
    if (inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside))
      throw new Error(
        `Cannot verify processor output scopes through external directory link "${relative}". Keep the lint project inside its explicit root.`
      )
    if (visited.has(real))
      throw new Error(`Cannot verify processor output scopes through directory cycle "${relative}".`)
    visited.add(real)

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ALWAYS_IGNORED.includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (!entry.isDirectory() && !(entry.isSymbolicLink() && statSync(path).isDirectory())) continue
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (matchesHost.some(matches => matches(child)))
        throw new Error(
          `Processor output scope collides with physical directory "${child}". Rename the directory or remove the ambiguous untypedFiles scope; physical source must retain type-aware rules.`
        )
      walk(path, child, depth + 1)
    }
    visited.delete(real)
  }

  walk(root, '')
  return patterns.map(({ files }) => toEngineGlob(files))
}

const needsTypeInformation = (name: string, plugins: Readonly<Record<string, unknown>>): boolean => {
  if (getRule(name)?.typeAware) return true

  const prefix = splitRule(name)
  const plugin = prefix ? plugins[prefix] : undefined
  const rule =
    prefix && isRecord(plugin) && isRecord(plugin.rules) ? plugin.rules[name.slice(prefix.length + 1)] : undefined
  const meta = isRecord(rule) && isRecord(rule.meta) ? rule.meta : undefined

  return isRecord(meta?.docs) && meta.docs.requiresTypeChecking === true
}

/** Keep the host parser, but never attach a TypeScript project to processor fragments. */
const integrateConfig = (config: FlatConfig[], options: EslintPlanOptions, plan: EslintPlan): FlatConfig[] => {
  const virtual = processorFiles(options.root, options.untypedFiles ?? [])
  const untyped = [...virtual, ...TOOL_CONFIG_FILES]
  const all = [...config, ...configBlocks(options.baseConfig ?? [])]
  const plugins: Record<string, unknown> = Object.assign(
    {},
    ...all.flatMap(block => (isRecord(block.plugins) ? [block.plugins] : [])),
    options.plugins
  )
  const typeRules = Object.fromEntries(
    all.flatMap(block =>
      isRecord(block.rules)
        ? Object.keys(block.rules)
            .filter(name => needsTypeInformation(name, plugins))
            .map(name => [name, 'off'])
        : []
    )
  )
  const routed = all.map((block): FlatConfig[] => {
    const language = isRecord(block.languageOptions) ? block.languageOptions : undefined
    const parser = isRecord(language?.parserOptions) ? language.parserOptions : undefined
    const typed =
      parser?.projectService ||
      parser?.project ||
      (isRecord(block.rules) && Object.keys(block.rules).some(name => needsTypeInformation(name, plugins)))
    if (!typed) return [block]
    const files = Array.isArray(block.files) ? block.files : ['**/*']
    return [
      { ...block, ignores: [...(Array.isArray(block.ignores) ? block.ignores : []), ...untyped] },
      {
        ...block,
        name: `${typeof block.name === 'string' ? block.name : 'pawl/shared'}/untyped`,
        files: files.flatMap(file => untyped.map(pattern => [...(Array.isArray(file) ? file : [file]), pattern])),
        languageOptions: { ...language, parserOptions: { ...parser, project: null, projectService: false } },
        rules: isRecord(block.rules)
          ? Object.fromEntries(Object.entries(block.rules).filter(([name]) => !needsTypeInformation(name, plugins)))
          : {}
      }
    ]
  })
  const result = routed.flat()

  if (Object.keys(typeRules).length > 0)
    result.push(
      {
        name: 'pawl/processor-fragments',
        files: virtual,
        languageOptions: { parserOptions: { project: null, projectService: false } },
        rules: typeRules
      },
      {
        name: 'pawl/tool-configs',
        files: TOOL_CONFIG_FILES,
        languageOptions: { parserOptions: { project: null, projectService: false } },
        rules: typeRules
      }
    )

  // A local shared-config exception must not replay a locked key after the policy.
  // Rule-only blocks preserve the host parser, processor, resolver and virtual-module settings.
  // The components the framework packs read hold scripts too, and get the floors through their parser.
  const components = activeComponentFiles(plan.activePacks, options)
  const hosts = [...(options.technologies?.includes('astro') ? ['**/*.astro'] : []), ...components]
  const physical = [...SCRIPT_FILES, ...hosts.filter((file, index) => hosts.indexOf(file) === index)]
  const rules: Rules = {}
  const typedRules: Rules = {}
  const twins: Rules = {}
  const componentTwins: Rules = {}
  const levels = effectiveRules(options.policy, {
    typescript: options.typescript,
    technologies: options.technologies ?? []
  })
  for (const name of options.policy.locked) {
    if (notFor(name, 'eslint')) continue
    const level = levels.get(name)
    if (!level || level === 'off') continue
    // Without shared config, retain normal delegation for non-framework projects.
    if (
      !options.baseConfig &&
      !options.technologies?.includes('astro') &&
      !all.some(block => isRecord(block.rules) && name in block.rules)
    )
      continue
    const eslintName = scopedRule(name, 'eslint') ?? name
    const prefix = splitRule(eslintName)
    const plugin = prefix ? plugins[prefix] : undefined
    if (
      prefix &&
      (!isRecord(plugin) || !isRecord(plugin.rules) || !isRecord(plugin.rules[eslintName.slice(prefix.length + 1)]))
    ) {
      plan.notEnforced.push({ rule: name, needs: `a ${prefix} implementation for the locked rule`, required: true })
      continue
    }
    const given = options.policy.options[name] ?? getRule(name)?.options?.eslint
    const target = needsTypeInformation(eslintName, plugins) ? typedRules : rules
    target[eslintName] = given ? [level, ...given] : level
    const twin = prefix ? undefined : getRule(name)?.aliases?.find(alias => alias.startsWith(`${TS_PREFIX}/`))
    if (twin && options.typescript && plugins[TS_PREFIX]) {
      twins[eslintName] = 'off'
      const twinTarget = needsTypeInformation(twin, plugins) ? typedRules : twins
      twinTarget[twin] = target[eslintName]
      // As in the base: a twin that needs a TypeScript program leaves the core rule in component scripts.
      if (twinTarget === twins) {
        componentTwins[eslintName] = 'off'
        componentTwins[twin] = target[eslintName]
      }
    }
  }
  const used = (values: Rules): Record<string, unknown> =>
    Object.fromEntries(
      Object.keys(values).flatMap(name => {
        const prefix = splitRule(name)
        return prefix && plugins[prefix] ? [[prefix, plugins[prefix]]] : []
      })
    )
  const locked: FlatConfig[] = []
  if (Object.keys(rules).length > 0) locked.push({ name: 'pawl/locked', files: physical, plugins: used(rules), rules })
  if (Object.keys(twins).length > 0)
    locked.push({ name: 'pawl/locked/typescript-twins', files: TS_FILES, plugins: used(twins), rules: twins })
  if (components.length > 0 && Object.keys(componentTwins).length > 0)
    locked.push({
      name: 'pawl/locked/components',
      files: components,
      plugins: used(componentTwins),
      rules: componentTwins
    })
  if (Object.keys(typedRules).length > 0)
    locked.push({
      name: 'pawl/locked/typescript',
      files: TS_FILES,
      ignores: untyped,
      plugins: used(typedRules),
      rules: typedRules
    })
  result.push(...scopeTechnologies(locked, options))

  // Replay the policy's ordered file exceptions after its global floors, keeping their original
  // intersections, exclusions and processor routing. Shared config contributes no policy floors.
  for (const block of routed.slice(0, config.length).flat()) {
    if (typeof block.name !== 'string' || !block.name.startsWith('pawl/override/') || !isRecord(block.rules)) continue
    const rules = Object.fromEntries(
      Object.entries(block.rules).filter(([name]) => options.policy.locked.includes(canonicalName(name)))
    )
    if (Object.keys(rules).length === 0) continue
    const { files, ignores } = block
    result.push({
      name: `${block.name}/locked`,
      ...(files === undefined ? {} : { files }),
      ...(ignores === undefined ? {} : { ignores }),
      plugins: used(rules),
      rules
    })
  }
  return result
}

const scopeRunnerRules = (config: FlatConfig[], policy: Policy): FlatConfig[] =>
  config.flatMap(block => {
    if (!isRecord(block.rules)) return [block]
    const kept = { ...block.rules }
    const scoped: FlatConfig[] = []
    for (const [name, value] of Object.entries(block.rules)) {
      const patterns = testRunnerFiles(policy, name)
      if (!patterns) continue
      delete kept[name]
      const files = Array.isArray(block.files) ? block.files : SCRIPT_FILES
      scoped.push({
        ...block,
        name: `${typeof block.name === 'string' ? block.name : 'pawl/shared'}/runner/${name}`,
        files: files.flatMap(file =>
          patterns.map(pattern => [...(Array.isArray(file) ? file : [file]), toEngineGlob(pattern)])
        ),
        rules: { [name]: value }
      })
    }
    return [{ ...block, rules: kept }, ...scoped]
  })

const validatePackFiles = (options: EslintPlanOptions): void => {
  for (const [name, files] of Object.entries(options.packFiles ?? {})) {
    if (!PACKS.some(pack => pack.name === name)) throw new Error(`Unknown packFiles pack: ${name}.`)
    if (files.length === 0 || files.some(file => typeof file !== 'string' || file.length === 0))
      throw new Error(`packFiles.${name} must contain nonempty file patterns.`)
  }
}

/** Work out the ESLint configuration for a policy, and what it cannot cover. */
export const eslintPlan = async (given: EslintPlanOptions): Promise<EslintPlan> => {
  const sharedPlugins: Record<string, unknown> = {}
  for (const block of configBlocks(given.baseConfig ?? [])) {
    if (!isRecord(block.plugins)) continue
    for (const [prefix, plugin] of Object.entries(block.plugins)) {
      if (sharedPlugins[prefix] !== undefined && sharedPlugins[prefix] !== plugin)
        throw new Error(
          `Shared ESLint config supplies multiple implementations for ${prefix}; choose one explicit integration.`
        )
      sharedPlugins[prefix] = plugin
    }
  }
  const options: EslintPlanOptions = { ...given, plugins: { ...sharedPlugins, ...given.plugins } }
  for (const [prefix, plugin] of Object.entries(options.plugins ?? {})) {
    if (!isRecord(plugin)) throw new Error(`The supplied ${prefix} plugin must be an object.`)
  }
  validatePackFiles(options)
  const { root, biomeActive, typescript } = options
  const loadedTs: Loaded = typescript ? await importVia(root, options.pluginRoots ?? [], 'typescript-eslint') : {}
  const suppliedTs = options.plugins?.[TS_PREFIX]
  const ts: Loaded =
    typescript && suppliedTs !== undefined ? { module: { ...loadedTs.module, plugin: suppliedTs } } : loadedTs
  const build: Build = {
    options,
    covered: name =>
      (biomeActive && getRule(name)?.biome !== undefined) ||
      (options.oxlintActive === true && oxlintCovers(getRule(name)?.name ?? name, options.oxlintTypeAware)),
    ts,
    plugins: new Map(typescript ? [[TS_PREFIX, ts]] : []),
    coreRules: {},
    pluginRules: {},
    tsRules: {},
    packRules: new Map(),
    packBlocks: [],
    needsTypes: false,
    coveredByBiome: [],
    notEnforced: [],
    activePacks: [],
    availablePacks: []
  }

  await loadPacks(build)
  await placeRules(build)
  applyGuards(build)
  applyOptions(build)

  // The rules for a technology only some packages use move to those packages, before the overrides.
  const blocks = scopeTechnologies([...(await baseConfigs(build)), ...packConfigs(build)], options)
  const config = [...blocks, ...(await overrideConfigs(build))].map(block => ({
    ...block,
    ...(isRecord(block.rules) ? { rules: { ...block.rules } } : {})
  }))
  const { coveredByBiome, notEnforced, activePacks, availablePacks } = build

  const plan = { config, coveredByBiome, notEnforced, activePacks, availablePacks }

  plan.config = scopeRunnerRules(integrateConfig(config, options, plan), options.policy)
  validateSuppliedRules(plan.config, options, plan)

  return plan
}

export interface EslintOptions extends EslintIntegrationOptions {
  /**
   * Project root. Pass `import.meta.dirname` from eslint.config.js, so the root does not depend on
   * where an editor starts ESLint. Without it, pawl looks up from the working directory for the
   * nearest pawl config, then the nearest ESLint config, then the nearest package.json.
   */
  root?: string
  /** Additional shared-config folders from which public plugin exports can resolve. */
  pluginRoots?: readonly string[]
  /** Actual plugin objects registered under explicit ESLint namespaces. */
  plugins?: Readonly<Record<string, unknown>>
}

/** The plan for a project as it stands on disk. */
export const eslintPlanFor = async (
  root: string,
  policy?: Policy,
  integration: Omit<EslintOptions, 'root'> = {}
): Promise<EslintPlan> => {
  const { policy: resolved, detection, tools } = await loadProject(root, policy)

  return eslintPlan({
    ...integration,
    root,
    policy: resolved,
    biomeActive: tools.linter === 'biome',
    oxlintActive: tools.linter === 'oxlint',
    oxlintTypeAware: tsgolintInstalled(root),
    typescript: detection.typescript,
    // One ESLint config covers the whole repo. It takes every technology in it, and gives the
    // rules for a technology only some packages use to those packages.
    technologies: allTechnologies(detection),
    sharedTechnologies: repoTechnologies(detection),
    packages: Object.fromEntries(
      detection.workspace.packages.map(dir => [
        dir,
        {
          technologies: packageTechnologies(detection)[dir] ?? [],
          dependencies: detection.workspace.dependencies[dir] ?? []
        }
      ])
    ),
    rootDependencies: detection.rootDependencies,
    dependencies: detection.dependencies,
    runtimes: detection.runtimes,
    ignores: detection.ignores
  })
}

/**
 * The project's ESLint flat config, built from its pawl policy.
 *
 * ```js
 * // eslint.config.js
 * import { eslint } from '@santi020k/pawl'
 *
 * export default eslint({ root: import.meta.dirname })
 * ```
 */
export const eslint = async ({ root, ...integration }: EslintOptions = {}): Promise<FlatConfig[]> => {
  const plan = await eslintPlanFor(root ?? findProjectRoot(process.cwd()), undefined, integration)
  const required = plan.notEnforced.filter(item => item.required)

  if (required.length > 0)
    throw new Error(
      `Pawl cannot enforce requested ESLint rules: ${required.map(item => `${item.rule} needs ${item.needs}`).join('; ')}.`
    )

  return plan.config
}
