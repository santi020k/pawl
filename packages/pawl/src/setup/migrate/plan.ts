import { readFileSync, renameSync } from 'node:fs'
import { extname, join } from 'node:path'
import { getPack, PACKS } from '../../catalog/packs.ts'
import { canonicalName, defaultLevel, getRule, type RuleDef } from '../../catalog/rules.ts'
import { importFromProject } from '../../engines/eslint/load.ts'
import { eslintPlan } from '../../engines/eslint/plan.ts'
import { effectiveRules, type RuleContext } from '../../policy/levels.ts'
import { findConfigFile, resolvePolicy, resolveSpecifier } from '../../policy/load.ts'
import { ESLINT_CONFIG_FILES, firstExisting } from '../../project/config-files.ts'
import { allTechnologies, type Detection, detect } from '../../project/detect.ts'
import { type Level, type Policy, type PolicyInput } from '../../types.ts'
import { writeText } from '../../utils/fs.ts'
import { isRecord, sameJson } from '../../utils/json.ts'
import { plural } from '../../utils/text.ts'
import { PACKAGE_NAME } from '../../version.ts'
import { type SetupAction } from '../plan.ts'
import { ESLINT_CONFIG, policyFile } from '../templates.ts'
import { MIGRATION_REPORT, type MigrateOptions, type MigratePlan, type RuleChange } from './migration.ts'
import {
  type CoreRules,
  type EslintClass,
  IMPORT_SORTING,
  legacyConfig,
  on,
  packFit,
  pickSamples,
  policyIgnores,
  rank,
  readIgnores,
  readLegacyIgnores,
  resolveSide,
  type Side,
  sharedConfigRoots,
  splitName
} from './read.ts'
import { reportFile } from './report.ts'
import { readMigrationScopes } from './scopes.ts'
import { readEditorconfig, readPrettier, styleFrom } from './style.ts'

const TS_TWIN = '@typescript-eslint/'

/** The catalog rule a name stands for. The typescript-eslint twin of a core rule stands for that rule. */
const catalogRule = (name: string): RuleDef | undefined =>
  getRule(name) ?? (name.startsWith(TS_TWIN) ? getRule(name.slice(TS_TWIN.length)) : undefined)

/** Options worth carrying: more than the empty defaults ESLint fills in. */
const hasOptions = (options: unknown[]): boolean => !['[]', '[{}]'].includes(JSON.stringify(options))

const NEW_EXTENSION: Record<string, string> = { '.cjs': '.mjs', '.cts': '.mts' }

/** The ESLint config to migrate from: a flat config, else a legacy one. */
interface Source {
  name: string
  path: string
  /** Set when the config is a legacy .eslintrc. */
  legacy: string | undefined
}

const findSource = (root: string): Source => {
  const flatName = firstExisting(root, ESLINT_CONFIG_FILES)
  const legacyName = flatName ? undefined : legacyConfig(root)
  const sourceName = flatName ?? legacyName

  if (!sourceName) throw new Error('No ESLint config here: neither a flat config (eslint.config.js) nor an .eslintrc.')

  const sourcePath = join(root, sourceName)

  if (flatName && readFileSync(sourcePath, 'utf8').includes(PACKAGE_NAME))
    throw new Error(`${sourceName} is already built from ${PACKAGE_NAME}. There is nothing to migrate.`)

  const existing = findConfigFile(root)

  if (existing)
    throw new Error(`${existing.slice(root.length + 1)} already exists. Move it away to migrate from ${sourceName}.`)

  return { name: sourceName, path: sourcePath, legacy: legacyName }
}

/** The project's ESLint, with the classes that read each kind of config. */
interface EslintClasses {
  /** Reads the config being migrated. */
  Reader: EslintClass
  /** Reads a flat config, for what pawl would hand ESLint. */
  Flat: EslintClass | undefined
  core: CoreRules
  major: number
}

const loadEslint = async (root: string, { name: sourceName, legacy: legacyName }: Source): Promise<EslintClasses> => {
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

  return { Reader, Flat, core, major }
}

/** What the migration compares in: the project, its ESLint, and the old config as ESLint resolved it. */
interface Migration {
  root: string
  detection: Detection
  context: RuleContext
  eslint: EslintClasses
  old: Side
  policyPath: string
  /** What every policy of this migration starts from: nothing, or the policy it extends. */
  base: PolicyInput
  /** The policy it extends, resolved, or the standard when it extends none. */
  basePolicy: Policy
  /** The policy it extends, as it was asked for. */
  parent: string | undefined
  /** The folders of the shared configs the old setup got its plugins from. */
  pluginRoots: readonly string[]
}

/** What pawl would hand ESLint for a policy, were ESLint the only linter, loading plugins from these folders too. */
const planFor = async (
  { root, detection, context, policyPath }: Migration,
  input: PolicyInput,
  pluginRoots: readonly string[]
): ReturnType<typeof eslintPlan> =>
  eslintPlan({
    root,
    policy: await resolvePolicy(input, policyPath),
    biomeActive: false,
    typescript: detection.typescript,
    ...context,
    dependencies: detection.dependencies,
    pluginRoots
  })

/** Resolve the rules of a policy with the plugins the old config had, its shared configs' own included. */
const pawlSide = async (migration: Migration, input: PolicyInput): Promise<Side> => {
  const { root, eslint, old } = migration
  const plan = await planFor(migration, input, migration.pluginRoots)

  if (!eslint.Flat) throw new Error(`ESLint ${eslint.major} cannot load a flat config`)

  const flat = new eslint.Flat({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })

  return resolveSide(
    flat,
    old.samples.map(file => [file]),
    eslint.core
  )
}

/** A pack for every plugin the old config turns rules on from, and the ones the policy has to name. */
const choosePacks = async ({
  root,
  detection,
  old,
  basePolicy,
  pluginRoots
}: Migration): Promise<{ packs: string[]; namedPacks: string[] }> => {
  // Packs: one for every plugin the old config has rules on from.
  const prefixes = new Set(on(old.rules).map(name => splitName(name).prefix))
  const packs: string[] = []
  const namedPacks: string[] = []

  for (const pack of PACKS.filter(candidate => prefixes.has(candidate.prefix))) {
    const fit = await packFit(root, pluginRoots, pack, old.rules)

    if (fit === 'none') continue

    const entry = fit === 'recommended' ? `${pack.name}/recommended` : pack.name

    packs.push(entry)

    // The policy it extends already names this one.
    if (basePolicy.packs.includes(entry)) continue

    // A pack whose trigger the project depends on switches on by itself and needs no line in the policy.
    if (entry !== pack.name || !pack.when.some(name => detection.dependencies.includes(name))) namedPacks.push(entry)
  }

  return { packs, namedPacks }
}

interface Levels {
  rules: Record<string, Level>
  changed: RuleChange[]
  policyKept: RuleChange[]
  importSorting: string[]
  added: string[]
  same: number
}

/**
 * The rule levels the policy carries over: the ones that differ from the standard. With a policy to
 * extend (`onto`), locked floors are retained and listed; unlocked source levels take precedence.
 */
const compareLevels = (
  old: Side,
  standard: Side,
  comparable: boolean,
  effective: Map<string, Level>,
  onto: Policy | undefined
): Levels => {
  const rules: Record<string, Level> = {}
  const changed: RuleChange[] = []
  const policyKept: RuleChange[] = []
  const importSorting: string[] = []
  const catalog = new Map<string, Level>()
  let same = 0
  /** Carry a level that differs, unless there is a policy to extend and the old level is looser than its level. */
  const keep = (rule: string, standardLevel: Level, kept: Level): void => {
    if (onto?.locked.includes(canonicalName(rule))) {
      const name = canonicalName(rule)
      // The floor of a locked rule, as pawl works it out when it merges the policies.
      const floor = onto.rules[name] ?? defaultLevel(name, onto.strict)

      if (rank(kept) < rank(floor)) {
        policyKept.push({ rule, standard: floor, kept })

        return
      }
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

  return { rules, changed, policyKept, importSorting: importSorting.sort(), added, same }
}

/** With the levels settled, the rules that cannot run and the options that differ from what pawl would set. */
const compareOptions = async (
  migration: Migration,
  policy: PolicyInput,
  packs: readonly string[],
  rules: Record<string, Level>
): Promise<{ options: Record<string, unknown[]>; biomeOptions: string[]; notEnforced: MigratePlan['notEnforced'] }> => {
  const { old } = migration
  const options: Record<string, unknown[]> = {}
  const biomeOptions: string[] = []
  let notEnforced: MigratePlan['notEnforced'] = []

  try {
    const final = await pawlSide(migration, { ...policy, packs: [...packs] })
    // What cannot run is asked of the project alone. A plugin that only the old shared config
    // brings is gone once that config is, so the project has to install it.
    const alone = await planFor(migration, { ...policy, packs: [...packs] }, [])

    // Only what the migration brought in: the standard's own gaps are for "pawl doctor" to report.
    const packTitles = new Set(packs.map(entry => `The ${getPack(entry)?.title} pack`))

    notEnforced = alone.notEnforced.filter(item => item.rule in rules || packTitles.has(item.rule))

    for (const [name, resolved] of old.rules) {
      const mine = final.rules.get(name)
      const def = catalogRule(name)

      if (resolved.level === 'off' || !mine || mine.level === 'off') continue

      if (!hasOptions(resolved.options) || sameJson(resolved.options, mine.options)) continue

      options[def?.name ?? name] = resolved.options

      if (def?.biome !== undefined) biomeOptions.push(def.name)
    }
  } catch {
    // The first attempt already left a note.
  }

  return { options, biomeOptions: biomeOptions.sort(), notEnforced }
}

/** The ESLint config pawl writes in place of the old one, keeping a backup, or a note when it keeps the old one. */
const planEslintFile = (
  root: string,
  source: Source,
  major: number,
  keepConfig: boolean,
  notes: string[]
): { actions: SetupAction[]; backup: string | undefined } => {
  const { name: sourceName, path: sourcePath, legacy: legacyName } = source
  const extension = extname(sourceName)
  // A legacy config is not read by a flat-config ESLint, so it can stay where it is.
  const backup = keepConfig || legacyName ? undefined : `eslint.config.before-pawl${extension}`
  const target = legacyName ? 'eslint.config.js' : `eslint.config${NEW_EXTENSION[extension] ?? extension}`
  const actions: SetupAction[] = []

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

  return { actions, backup }
}

/** The package a specifier names: `@acme/policy/strict` is in `@acme/policy`. */
const packageOf = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/')

/** The package of the policy to extend, having made sure the project can load it. Undefined for a path. */
const policyPackageOf = (parent: string | undefined, policyPath: string): string | undefined => {
  if (parent === undefined || /^[./]/.test(parent)) return undefined

  const name = packageOf(parent)

  try {
    resolveSpecifier(parent, policyPath)
  } catch (cause) {
    throw new Error(
      `Cannot find the policy "${parent}" from this project. Install ${name} here first, then migrate again.`,
      { cause }
    )
  }

  return name
}

/** Read an existing ESLint flat config and work out the pawl policy that keeps its rules. */
export const planMigrate = async ({
  root,
  keepConfig = false,
  extends: parent
}: MigrateOptions): Promise<MigratePlan> => {
  const source = findSource(root)
  const eslint = await loadEslint(root, source)
  const policyPath = join(root, 'pawl.config.ts')
  const base: PolicyInput = parent === undefined ? {} : { extends: parent }
  const policyPackage = policyPackageOf(parent, policyPath)
  const basePolicy = await resolvePolicy(base, policyPath)
  const parentScoped = basePolicy.overrides.flatMap(override => [
    ...Object.keys(override.rules),
    ...Object.keys(override.options),
    ...Object.keys(override.biomeOptions)
  ])
  const scopes = await readMigrationScopes(source.path, source.legacy, eslint.core, parentScoped)
  const detection = detect(root)
  const context: RuleContext = {
    typescript: detection.typescript,
    technologies: allTechnologies(detection),
    dependencies: detection.dependencies
  }
  const old = await resolveSide(new eslint.Reader({ cwd: root }), pickSamples(root, detection.typescript), eslint.core)

  // A future-only scope still needs its plugin and pack, even with no sample in today's tree.
  for (const [name, rule] of scopes.rules) {
    if (!scopes.names.has(canonicalName(name))) continue

    const previous = old.rules.get(name)

    if (!previous || rank(rule.level) > rank(previous.level)) old.rules.set(name, rule)
  }

  if (old.samples.length === 0) throw new Error(`${source.name} does not apply to any file pawl could find.`)

  const notes: string[] = []

  const migration: Migration = {
    root,
    detection,
    context,
    eslint,
    old,
    policyPath,
    base,
    basePolicy,
    parent,
    pluginRoots: sharedConfigRoots(root)
  }
  const { packs, namedPacks } = await choosePacks(migration)
  let standard: Side = { rules: new Map(), formatting: new Map(), samples: [] }
  let comparable = true

  try {
    standard = await pawlSide(migration, { ...base, packs })
  } catch (cause) {
    comparable = false
    notes.push(
      `Could not resolve the pawl standard through ESLint (${(cause as Error).message.split('\n')[0]}). Every plugin rule that is on was carried over as is.`
    )
  }

  const effective = effectiveRules(await resolvePolicy({ ...base, packs }, policyPath), context)
  const { rules, changed, policyKept, importSorting, added, same } = compareLevels(
    old,
    standard,
    comparable,
    effective,
    parent === undefined ? undefined : basePolicy
  )
  const configured = readPrettier(root)
  // Prettier's CLI reads .editorconfig for what its own config leaves out.
  const prettier = configured && { ...readEditorconfig(root), ...configured }
  const style = styleFrom(old.formatting, prettier, basePolicy.style)

  if (detection.tools.prettier && !prettier) {
    notes.push(
      `Could not read the Prettier config in ${detection.tools.prettier}. Set "style" in the policy to match it, or "pawl fix" will format the code to the standard's style.`
    )
  }

  const read = source.legacy ? readLegacyIgnores(root) : await readIgnores(source.path)
  /** The policy it extends does not skip this already. */
  const fresh = (pattern: string): boolean => !basePolicy.ignore.includes(pattern)
  const ignore = read && policyIgnores(root, read.filter(fresh), notes).filter(fresh)
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
      `Could not read the ignore patterns of ${source.name}. Add the folders to skip to "ignore" in the policy.`
    )

  const { options, biomeOptions, notEnforced } = await compareOptions(migration, policy, packs, rules)

  if (Object.keys(options).length > 0)
    policy.options = Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)))

  if (scopes.names.size > 0) {
    const globalRules = { ...policy.rules }
    const globalOptions = { ...policy.options }

    for (const name of scopes.names) {
      // Scoped-only rules must not escape through either the standard or an inferred pack.
      const floor = parent === undefined ? 'off' : (effective.get(name) ?? standard.rules.get(name)?.level ?? 'off')

      globalRules[name] = floor
      delete globalOptions[name]
    }

    for (let index = changed.length - 1; index >= 0; index--) {
      const change = changed[index]

      if (change && scopes.names.has(change.rule)) changed.splice(index, 1)
    }

    // Sampled comparisons do not describe ordered scoped replay. Recompute retained floors below.
    for (let index = policyKept.length - 1; index >= 0; index--) {
      const change = policyKept[index]
      if (change && scopes.names.has(change.rule)) policyKept.splice(index, 1)
    }

    policy.rules = globalRules
    policy.options = globalOptions
    // ESLint keeps earlier options when a later rule only changes severity. An empty option list
    // cannot clear arguments supplied by a preset; refuse rather than silently inheriting them.
    const generated = await planFor(migration, { ...policy, packs }, migration.pluginRoots)
    const presetOptions = new Set(
      generated.config.flatMap(config => {
        if (!isRecord(config.rules)) return []

        return Object.entries(config.rules).flatMap(([name, value]) =>
          Array.isArray(value) && value.length > 1 ? [canonicalName(name)] : []
        )
      })
    )

    for (const override of scopes.overrides) {
      for (const [name, values] of Object.entries(override.options ?? {})) {
        if (values.length === 0 && presetOptions.has(name))
          throw new Error(
            `Cannot preserve ESLint file scopes: ${name} would inherit options from a pawl preset. Set explicit options in the source config before migrating; no files were written.`
          )
      }
    }

    // Replay explicit source scopes after inherited scopes. Only locked rules are floors:
    // unlocked parent exceptions remain wherever the source does not name the rule.
    policy.overrides = scopes.overrides.map(override => ({
      ...override,
      rules: Object.fromEntries(
        Object.entries(override.rules ?? {}).map(([name, level]) => {
          const floor = globalRules[name] ?? 'off'

          if (basePolicy.locked.includes(name) && rank(level) < rank(floor)) {
            if (!policyKept.some(change => change.rule === name && change.kept === level))
              policyKept.push({ rule: name, standard: floor, kept: level })

            return [name, floor]
          }

          return [name, level]
        })
      )
    }))

    for (const override of policy.overrides) {
      for (const [name, values] of Object.entries(override.options ?? {})) {
        if (values.length > 0 && getRule(name)?.biome !== undefined && !biomeOptions.includes(name))
          biomeOptions.push(name)
      }
    }

    biomeOptions.sort()
    notes.push(
      `Preserved ${plural(policy.overrides.length, 'ordered rule override')} using the original file patterns, including future files. Their global fallback is off unless the parent policy requires a stricter level.`
    )
  }

  const formatting = on(old.formatting).sort()
  const summary = {
    source: source.name,
    samples: old.samples,
    policy,
    notes,
    total: on(old.rules).length + formatting.length,
    same,
    changed,
    added,
    policyKept,
    ...(policyPackage ? { policyPackage } : {}),
    formatting,
    importSorting,
    packs,
    biomeOptions,
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
  const eslintFile = planEslintFile(root, source, eslint.major, keepConfig, notes)
  const actions: SetupAction[] = [
    {
      path: 'pawl.config.ts',
      kind: 'create',
      summary: carried.length > 0 ? carried.join(', ') : 'the standard as is',
      apply: () => writeText(policyPath, policyFile(policy))
    },
    ...eslintFile.actions,
    {
      path: MIGRATION_REPORT,
      kind: 'create',
      summary: 'what was carried over and what was not',
      apply: () => writeText(join(root, MIGRATION_REPORT), reportFile(summary, eslintFile.backup))
    }
  ]

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
