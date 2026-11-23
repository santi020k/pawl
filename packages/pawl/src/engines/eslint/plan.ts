import { IMPORTS_RULE, importRestrictions, SYNTAX_RULE, syntaxRestrictions } from '../../catalog/guards.ts'
import { PACKS, type Pack } from '../../catalog/packs.ts'
import { getRule, isGated, notFor, scopedRule, type Technology } from '../../catalog/rules.ts'
import { extraGlobals, ownGlobals, RUNTIME_GLOBALS } from '../../catalog/runtimes.ts'
import { effectiveRules, overrideRules } from '../../policy/levels.ts'
import { findProjectRoot } from '../../policy/load.ts'
import { loadProject } from '../../policy/project.ts'
import { allTechnologies, packageTechnologies, technologies as repoTechnologies } from '../../project/detect.ts'
import { ALWAYS_IGNORED, allIgnores, toEngineGlob, toEslintIgnores } from '../../project/ignores.ts'
import { type Policy, type Runtime } from '../../types.ts'
import { isRecord } from '../../utils/json.ts'
import { toList } from '../../utils/list.ts'
import { oxlintCovers, tsgolintInstalled } from '../oxlint/config.ts'
import {
  follow,
  importFromProject,
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

export interface EslintPlan {
  config: FlatConfig[]
  /** Rules left to Biome because it enforces them faster. */
  coveredByBiome: string[]
  /** Rules and packs that are wanted but cannot run, and the plugin each one needs. */
  notEnforced: Array<{ rule: string; needs: string }>
  /** Packs that are switched on. */
  activePacks: string[]
  /** Packs that fit what the project depends on, but whose plugin is not installed. */
  availablePacks: string[]
}

export interface EslintPlanOptions {
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
    if (typeof file !== 'string') return [[`${dir}/**`, ...toList(file as string | readonly string[])]]

    const pattern = file.replace(/^\.?\//, '')

    if (pattern.startsWith(`${dir}/`)) return [pattern]

    return dirs.some(other => pattern.startsWith(`${other}/`)) ? [] : [`${dir}/${pattern}`]
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
        ...(ignores ? { ignores } : {}),
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

    const loaded = pack.name === 'typescript' ? ts : await importVia(root, pluginRoots, pack.plugin)

    if (!loaded.module) {
      if (reason === 'suggested' && !loaded.error) availablePacks.push(pack.name)
      else notEnforced.push({ rule: `The ${pack.title} pack`, needs: needs(pack.plugin, loaded) })

      continue
    }

    const entry = entryFor(policy.packs, pack)
    const chosen = entry !== undefined && entry !== pack.name ? entry.slice(pack.name.length + 1) : undefined
    const own = chosen === undefined ? undefined : pluginPreset(loaded.module, chosen, pack.prefix)

    if (chosen !== undefined && !own) {
      notEnforced.push({ rule: `The ${pack.title} pack`, needs: `a preset named "${chosen}" in ${pack.plugin}` })

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

    if (!plugins.has(prefix)) plugins.set(prefix, await importVia(root, pluginRoots, pluginPackage(prefix)))

    const loaded = plugins.get(prefix) as Loaded

    if (!loaded.module) {
      notEnforced.push({ rule: name, needs: needs(pluginPackage(prefix), loaded) })

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
  const otherPlugins = Object.fromEntries(
    [...plugins].flatMap(([prefix, loaded]) => (prefix !== TS_PREFIX && loaded.module ? [[prefix, loaded.module]] : []))
  )

  config.push({
    name: 'pawl/base',
    files: SCRIPT_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: await globalsFor(root, options.runtimes ?? ['node', 'browser']),
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
        parser: tseslint.parser,
        parserOptions: build.needsTypes ? { projectService: true, tsconfigRootDir: root } : {}
      },
      plugins: { [TS_PREFIX]: tseslint.plugin },
      rules: tsRules
    })
  } else if (typescript && !notEnforced.some(item => item.rule === 'The TypeScript pack')) {
    notEnforced.push({ rule: 'TypeScript files', needs: needs('typescript-eslint', ts) })
  }

  return config
}

/** One block per active pack, with the rules the installed plugin has. */
const packConfigs = ({ covered, packRules, packBlocks, notEnforced }: Build): FlatConfig[] => {
  const config: FlatConfig[] = []

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
        if (rules[name] !== 'off') notEnforced.push({ rule: name, needs: `a version of ${pack.plugin} that has it` })

        delete rules[name]
      }
    }

    if (pack.spread) {
      // The plugin's own flat config brings its parser and file patterns; pawl adds its levels after.
      config.push(...(toList(presetOf(pack, plugin) as FlatConfig | readonly FlatConfig[] | undefined) as FlatConfig[]))
      config.push({
        name: `pawl/pack/${pack.name}`,
        ...(pack.files ? { files: pack.files } : {}),
        plugins: { [pack.prefix]: plugin },
        rules
      })
    } else {
      const parser = follow(plugin, pack.parser ?? [])

      const files = pack.files ?? SCRIPT_FILES

      config.push({
        name: `pawl/pack/${pack.name}`,
        // A pack for what only some packages depend on runs in those packages.
        files: dirs ? dirs.flatMap(dir => within(files, dir)) : files,
        ...(pack.ignores ? { ignores: pack.ignores } : {}),
        ...(pack.parser && parser ? { languageOptions: { parser } } : {}),
        plugins: { [pack.prefix]: plugin },
        rules
      })
    }
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
  for (const [index, override] of policy.overrides.entries()) {
    const rules: Rules = {}
    const twins: Rules = {}
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
          const loaded = await importVia(root, pluginRoots, pluginPackage(prefix))

          if (!loaded.module) {
            notEnforced.push({ rule: name, needs: needs(pluginPackage(prefix), loaded) })

            continue
          }

          loadedPlugins.set(prefix, loaded.module)
        }

        used[prefix] = loadedPlugins.get(prefix)
      }

      rules[eslintName] = value

      // In TypeScript files the typescript-eslint twin of a core rule stands in for it, as in the base.
      const twin = prefix ? undefined : def?.aliases?.find(alias => alias.startsWith(`${TS_PREFIX}/`))

      if (twin && tseslint) {
        twins[eslintName] = 'off'
        twins[twin] = value
      }
    }

    const files = override.files.map(toEngineGlob)

    if (Object.keys(rules).length > 0) {
      config.push({
        name: `pawl/override/${index}`,
        files,
        ...(Object.keys(used).length > 0 ? { plugins: used } : {}),
        rules
      })
    }

    if (tseslint && Object.keys(twins).length > 0) {
      // A file must match both the override and the TypeScript patterns.
      config.push({
        name: `pawl/override/${index}/typescript`,
        files: files.map(glob => [glob, ...TS_FILES]),
        plugins: { [TS_PREFIX]: tseslint.plugin },
        rules: twins
      })
    }
  }

  return config
}

/** Work out the ESLint configuration for a policy, and what it cannot cover. */
export const eslintPlan = async (options: EslintPlanOptions): Promise<EslintPlan> => {
  const { root, biomeActive, typescript } = options
  const ts: Loaded = typescript ? await importVia(root, options.pluginRoots ?? [], 'typescript-eslint') : {}
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
  const config = [...blocks, ...(await overrideConfigs(build))]
  const { coveredByBiome, notEnforced, activePacks, availablePacks } = build

  return { config, coveredByBiome, notEnforced, activePacks, availablePacks }
}

export interface EslintOptions {
  /**
   * Project root. Pass `import.meta.dirname` from eslint.config.js, so the root does not depend on
   * where an editor starts ESLint. Without it, pawl looks up from the working directory for the
   * nearest pawl config, then the nearest ESLint config, then the nearest package.json.
   */
  root?: string
}

/** The plan for a project as it stands on disk. */
export const eslintPlanFor = async (root: string, policy?: Policy): Promise<EslintPlan> => {
  const { policy: resolved, detection, tools } = await loadProject(root, policy)

  return eslintPlan({
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
export const eslint = async ({ root }: EslintOptions = {}): Promise<FlatConfig[]> =>
  (await eslintPlanFor(root ?? findProjectRoot(process.cwd()))).config
