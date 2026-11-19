import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allTechnologies, detect } from '../detect.ts'
import { toList, toPosix } from '../fs-utils.ts'
import { IMPORTS_RULE, importRestrictions, SYNTAX_RULE, syntaxRestrictions } from '../guards.ts'
import { ALWAYS_IGNORED, allIgnores, toEngineGlob, toEslintIgnores } from '../ignores.ts'
import { PACKS, type Pack } from '../packs.ts'
import { effectiveRules, findProjectRoot, loadPolicy, overrideRules, resolveSpecifier } from '../policy.ts'
import { getRule, type Technology } from '../rules.ts'
import { extraGlobals, ownGlobals, RUNTIME_GLOBALS } from '../runtime.ts'
import { toolset } from '../tools.ts'
import { type Finding, type Policy, type Runtime } from '../types.ts'
import { type EngineRun, type RunOptions } from './biome.ts'
import { oxlintCovers } from './oxlint.ts'
import { EngineError, runNode } from './run.ts'

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

const TS_PREFIX = '@typescript-eslint'

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
  typescript: boolean
  /** The technologies the project uses. Rules for any other technology are left out. */
  technologies?: readonly Technology[]
  /** Every dependency in the repo, used to switch packs on. */
  dependencies?: readonly string[]
  /** Where the code runs, for the globals ESLint knows. Node and the browser when not given. */
  runtimes?: readonly Runtime[]
}

/** Plugins whose package name does not follow the eslint-plugin-<prefix> convention. */
const PLUGIN_PACKAGES: Record<string, string> = {
  [TS_PREFIX]: 'typescript-eslint',
  vitest: '@vitest/eslint-plugin'
}

const pluginPackage = (prefix: string): string => {
  const known = PLUGIN_PACKAGES[prefix] ?? PACKS.find(pack => pack.prefix === prefix)?.plugin

  if (known) return known

  return prefix.startsWith('@') ? `${prefix}/eslint-plugin` : `eslint-plugin-${prefix}`
}

interface Loaded {
  module?: Record<string, unknown>
  /** Why the package could not be used, when it is installed but fails to load. */
  error?: string
}

/** Import a package the way the project itself would, not the way pawl would. */
export const importFromProject = async (root: string, specifier: string): Promise<Loaded> => {
  let file: string

  try {
    file = resolveSpecifier(specifier, join(root, 'package.json'))
  } catch {
    return {}
  }

  try {
    const loaded = (await import(pathToFileURL(file).href)) as Record<string, unknown>

    return { module: (loaded.default as Record<string, unknown> | undefined) ?? loaded }
  } catch (error) {
    return { error: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'failed to load' }
  }
}

/**
 * Import a pack's plugin. ESLint itself depends on @eslint/js, so a project that does not list
 * that package still has it: it is looked up from where ESLint is installed.
 */
export const importPlugin = async (root: string, specifier: string): Promise<Loaded> => {
  const loaded = await importFromProject(root, specifier)

  if (loaded.module || loaded.error || specifier !== '@eslint/js') return loaded

  try {
    const eslintDir = dirname(resolveSpecifier('eslint/package.json', join(root, 'package.json')))

    return await importFromProject(eslintDir, specifier)
  } catch {
    return loaded
  }
}

/** What a missing or broken plugin needs, in words a person can act on. */
const needs = (packageName: string, loaded: Loaded): string =>
  loaded.error ? `${packageName}, which is installed but failed to load: ${loaded.error}` : packageName

const splitRule = (name: string): string | undefined => {
  const slash = name.lastIndexOf('/')

  return slash === -1 ? undefined : name.slice(0, slash)
}

type RuleValue = unknown

type Rules = Record<string, RuleValue>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Read the rules out of a plugin preset: a rules object, a flat config, or a list of flat configs. */
const presetRules = (value: unknown): Rules => {
  if (Array.isArray(value)) return Object.assign({}, ...value.map(presetRules)) as Rules

  if (!isRecord(value)) return {}

  if (isRecord(value.rules)) return { ...value.rules }

  const looksLikeRules = Object.values(value).every(
    entry => ['string', 'number'].includes(typeof entry) || Array.isArray(entry)
  )

  return looksLikeRules ? { ...value } : {}
}

/** The rules a pack starts from: the part of the plugin's exports the pack points at. */
export const packPreset = (pack: Pack, plugin: Record<string, unknown>): Rules => presetRules(presetOf(pack, plugin))

const presetOf = (pack: Pack, plugin: Record<string, unknown>): unknown =>
  (pack.preset ?? []).reduce<unknown>(
    (value, key) => (isRecord(value) ? value[key] : undefined),
    pack.preset ? plugin : undefined
  )

/** The policy's entry for a pack: its name, or its name and one of the plugin's own presets (`unicorn/recommended`). */
const entryFor = (packs: readonly string[], pack: Pack): string | undefined =>
  packs.find(entry => entry === pack.name || entry.startsWith(`${pack.name}/`))

/** The rules of one of a plugin's own presets, by name. Only the plugin's own rules: a preset may also switch core rules off. */
export const pluginPreset = (plugin: Record<string, unknown>, name: string, prefix: string): Rules | undefined => {
  const configs = isRecord(plugin.configs) ? plugin.configs : {}
  const found = configs[name] ?? configs[`flat/${name}`]

  if (found === undefined) return undefined

  return Object.fromEntries(Object.entries(presetRules(found)).filter(([rule]) => rule.startsWith(`${prefix}/`)))
}

/** A pack is wanted when the policy names it, the project depends on what it is for, or ESLint is the linter. */
const wants = (pack: Pack, options: EslintPlanOptions): 'named' | 'auto' | 'suggested' | undefined => {
  if (entryFor(options.policy.packs, pack)) return 'named'

  const eslintLints = !options.biomeActive && options.oxlintActive !== true

  if (pack.auto === 'linter' && eslintLints) return 'auto'

  if (pack.auto === 'linter-ts' && eslintLints && options.typescript) return 'auto'

  return pack.when.some(name => (options.dependencies ?? []).includes(name)) ? 'suggested' : undefined
}

/** Work out the ESLint configuration for a policy, and what it cannot cover. */
export const eslintPlan = async (options: EslintPlanOptions): Promise<EslintPlan> => {
  const { root, policy, biomeActive, typescript, technologies = [] } = options
  /** The fast linter already enforces this rule, so ESLint leaves it alone. */
  const covered = (name: string): boolean =>
    (biomeActive && getRule(name)?.biome !== undefined) ||
    (options.oxlintActive === true && oxlintCovers(getRule(name)?.name ?? name))
  const coveredByBiome: string[] = []
  const notEnforced: EslintPlan['notEnforced'] = []
  const activePacks: string[] = []
  const availablePacks: string[] = []
  const plugins = new Map<string, Loaded>()
  const coreRules: Rules = {}
  const pluginRules: Rules = {}
  const tsRules: Rules = {}
  /** The rules of each active pack, by pack name. */
  const packRules = new Map<string, Rules>()
  /** The policy's options, less the two rules the guards build themselves. */
  const remainingOptions: Record<string, unknown[]> = { ...policy.options }
  const packBlocks: Array<{ pack: Pack; plugin: Record<string, unknown>; fromPlugin: Set<string> }> = []
  let needsTypes = false

  // TypeScript files need the typescript-eslint parser even when no TypeScript rule is on.
  const loadedTs = typescript ? await importFromProject(root, 'typescript-eslint') : {}
  const tseslint = loadedTs.module

  if (typescript) plugins.set(TS_PREFIX, loadedTs)

  for (const pack of PACKS) {
    const reason = wants(pack, options)

    if (!reason) continue

    const loaded = pack.name === 'typescript' ? loadedTs : await importPlugin(root, pack.plugin)

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
      packBlocks.push({ pack, plugin: loaded.module, fromPlugin: new Set(Object.keys(preset)) })
    }

    needsTypes ||= pack.typeAware === true
  }

  for (const [name, level] of effectiveRules(policy, { typescript, technologies })) {
    if (name.startsWith('biome:') || name.startsWith('pawl/')) continue

    const def = getRule(name)

    if (covered(name)) {
      if (level !== 'off') coveredByBiome.push(name)

      continue
    }

    const eslintName = name.startsWith('eslint:') ? name.slice('eslint:'.length) : name
    const ruleOptions = policy.options[name] ?? def?.options?.eslint
    const value: RuleValue = level !== 'off' && ruleOptions ? [level, ...ruleOptions] : level
    const prefix = splitRule(eslintName)
    // Two packs can share a plugin. The rule goes to the ones that already have it, else to the first.
    const withPrefix = packBlocks.flatMap(({ pack }) =>
      pack.prefix === prefix ? [packRules.get(pack.name) ?? {}] : []
    )
    const holders = withPrefix.filter(rules => eslintName in rules)
    const inPack = holders.length > 0 ? holders : withPrefix.slice(0, 1)

    // A rule that is off only needs saying where a preset may have turned it on.
    if (level === 'off' && holders.length === 0 && !(eslintName in coreRules) && !(eslintName in tsRules)) continue

    // Where Biome lints, ESLint is only there for the packs. A catalog rule Biome has no equivalent
    // for runs when its plugin's pack is on or the policy names it; it does not ask for a plugin by itself.
    if (biomeActive && def && !def.biome && withPrefix.length === 0 && policy.rules[name] === undefined) continue

    if (!prefix) {
      coreRules[eslintName] = value

      // In TypeScript files the typescript-eslint twin of a core rule replaces it.
      const twin = def?.aliases?.find(alias => alias.startsWith(`${TS_PREFIX}/`))

      if (twin && tseslint && level !== 'off') {
        tsRules[eslintName] = 'off'
        tsRules[twin] = value
      }

      continue
    }

    if (prefix && inPack.length > 0) {
      for (const rules of inPack) rules[eslintName] = value

      continue
    }

    if (!plugins.has(prefix)) plugins.set(prefix, await importFromProject(root, pluginPackage(prefix)))

    const loaded = plugins.get(prefix) as Loaded

    if (!loaded.module) {
      notEnforced.push({ rule: name, needs: needs(pluginPackage(prefix), loaded) })

      continue
    }

    if (prefix === TS_PREFIX) {
      tsRules[eslintName] = value
      needsTypes ||= def?.typeAware === true
    } else {
      pluginRules[eslintName] = value
    }
  }

  // Guards: imports and code patterns to stay away from, for the libraries the project uses.
  const imports = importRestrictions(policy, options.dependencies)
  // Biome runs the guards' code patterns as pawl's own rules, so ESLint keeps only the project's.
  const syntax = syntaxRestrictions(policy, options.dependencies, { guards: !biomeActive })

  // Biome and Oxlint both restrict imports themselves.
  if (imports && (biomeActive || options.oxlintActive === true)) {
    delete coreRules[IMPORTS_RULE]
    coveredByBiome.push(IMPORTS_RULE)
  } else if (imports) coreRules[IMPORTS_RULE] = [imports.level, imports.eslint]

  if (syntax) coreRules[SYNTAX_RULE] = [syntax.level, ...syntax.options]

  // Options the policy sets for rules whose level comes from a pack or a preset.
  for (const name of [IMPORTS_RULE, SYNTAX_RULE]) delete remainingOptions[name]

  for (const rules of [coreRules, pluginRules, tsRules, ...packRules.values()]) {
    for (const [name, ruleOptions] of Object.entries(remainingOptions)) {
      const current = rules[name]
      const severity: unknown = Array.isArray(current) ? current[0] : current

      if (current !== undefined && severity !== 'off' && severity !== 0) rules[name] = [severity, ...ruleOptions]
    }
  }

  // The defaults, the root .gitignore and the policy's own patterns, in that order, as pawl reads them.
  const ignores = [
    ...new Set([...ALWAYS_IGNORED.map(dir => `**/${dir}/**`), ...allIgnores(root, policy).flatMap(toEslintIgnores)])
  ]
  const config: FlatConfig[] = [{ name: 'pawl/ignores', ignores }]
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
        parserOptions: needsTypes ? { projectService: true, tsconfigRootDir: root } : {}
      },
      plugins: { [TS_PREFIX]: tseslint.plugin },
      rules: tsRules
    })
  } else if (typescript && !notEnforced.some(item => item.rule === 'The TypeScript pack')) {
    notEnforced.push({ rule: 'TypeScript files', needs: needs('typescript-eslint', loadedTs) })
  }

  for (const { pack, plugin, fromPlugin } of packBlocks) {
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
      const parser = (pack.parser ?? []).reduce<unknown>(
        (value, key) => (isRecord(value) ? value[key] : undefined),
        plugin
      )

      config.push({
        name: `pawl/pack/${pack.name}`,
        files: pack.files ?? SCRIPT_FILES,
        ...(pack.ignores ? { ignores: pack.ignores } : {}),
        ...(pack.parser && parser ? { languageOptions: { parser } } : {}),
        plugins: { [pack.prefix]: plugin },
        rules
      })
    }
  }

  // Overrides go last, so they win over the base rules and the packs for the files they name.
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
      if (name.startsWith('biome:') || name.startsWith('oxlint:') || name.startsWith('pawl/') || covered(name)) continue

      const def = getRule(name)
      const eslintName = name.startsWith('eslint:') ? name.slice('eslint:'.length) : name
      const ruleOptions = override.options[name] ?? policy.options[name] ?? def?.options?.eslint
      const value: RuleValue = level !== 'off' && ruleOptions ? [level, ...ruleOptions] : level
      const prefix = splitRule(eslintName)

      if (prefix) {
        if (!loadedPlugins.has(prefix)) {
          const loaded = await importFromProject(root, pluginPackage(prefix))

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
  const resolved = policy ?? (await loadPolicy(root))
  const detection = detect(root, resolved)

  return eslintPlan({
    root,
    policy: resolved,
    biomeActive: toolset(root, resolved).linter === 'biome',
    oxlintActive: toolset(root, resolved).linter === 'oxlint',
    typescript: detection.typescript,
    // One ESLint config covers the whole repo, so it takes every technology in it.
    technologies: allTechnologies(detection),
    dependencies: detection.dependencies,
    runtimes: detection.runtimes
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

interface EslintMessage {
  ruleId: string | null
  severity: number
  message: string
  line?: number
  column?: number
  fix?: unknown
}

interface EslintResult {
  filePath: string
  messages: EslintMessage[]
}

const resolveBin = (root: string): string | undefined => {
  try {
    return join(dirname(createRequire(join(root, 'package.json')).resolve('eslint/package.json')), 'bin', 'eslint.js')
  } catch {
    return undefined
  }
}

export const eslintInstalled = (root: string): boolean => resolveBin(root) !== undefined

/** Run the project's ESLint and turn its report into findings. */
export const runEslint = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root)

  if (!bin)
    throw new EngineError('ESLint is not installed in this project. Add it with your package manager.', {
      command: 'eslint'
    })

  const args = ['--format', 'json', '--no-warn-ignored', '--no-error-on-unmatched-pattern']

  if (write) args.push('--fix')

  args.push(...(files && files.length > 0 ? files : ['.']))

  const result = await runNode(bin, args, root, 'eslint')
  const start = result.stdout.indexOf('[')

  if (result.code > 1 || start === -1) {
    throw new EngineError(result.stderr.trim() || result.stdout.trim() || `ESLint exited with code ${result.code}.`, {
      command: result.command
    })
  }

  const results = JSON.parse(result.stdout.slice(start)) as EslintResult[]
  const findings: Finding[] = []

  for (const { filePath, messages } of results) {
    const file = toPosix(filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath)

    for (const message of messages) {
      findings.push({
        file,
        line: Math.max(1, message.line ?? 1),
        column: Math.max(1, message.column ?? 1),
        engine: 'eslint',
        engineRule: message.ruleId ?? 'parse',
        rule: message.ruleId ?? 'eslint:parse',
        severity: message.severity === 2 ? 'error' : 'warn',
        message: message.message,
        fixable: message.fix !== undefined
      })
    }
  }

  return {
    findings,
    command: result.command.replace(' --format json --no-warn-ignored --no-error-on-unmatched-pattern', '')
  }
}
