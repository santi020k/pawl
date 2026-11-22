import { readFileSync, renameSync } from 'node:fs'
import { extname, join } from 'node:path'
import { getPack, PACKS } from '../../catalog/packs.ts'
import { getRule, type RuleDef } from '../../catalog/rules.ts'
import { importFromProject } from '../../engines/eslint/load.ts'
import { eslintPlan } from '../../engines/eslint/plan.ts'
import { effectiveRules, type RuleContext } from '../../policy/levels.ts'
import { findConfigFile, resolvePolicy } from '../../policy/load.ts'
import { ESLINT_CONFIG_FILES, firstExisting } from '../../project/config-files.ts'
import { allTechnologies, type Detection, detect } from '../../project/detect.ts'
import { type Level, type PolicyInput } from '../../types.ts'
import { writeText } from '../../utils/fs.ts'
import { sameJson } from '../../utils/json.ts'
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
  splitName
} from './read.ts'
import { reportFile } from './report.ts'
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
}

/** Resolve what pawl would hand ESLint for a policy, were ESLint the only linter. */
const pawlSide = async (
  { root, detection, context, eslint, old, policyPath }: Migration,
  input: PolicyInput
): Promise<{ side: Side; notEnforced: MigratePlan['notEnforced'] }> => {
  const plan = await eslintPlan({
    root,
    policy: await resolvePolicy(input, policyPath),
    biomeActive: false,
    typescript: detection.typescript,
    ...context,
    dependencies: detection.dependencies
  })

  if (!eslint.Flat) throw new Error(`ESLint ${eslint.major} cannot load a flat config`)

  const flat = new eslint.Flat({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })

  return {
    side: await resolveSide(
      flat,
      old.samples.map(file => [file]),
      eslint.core
    ),
    notEnforced: plan.notEnforced
  }
}

/** A pack for every plugin the old config turns rules on from, and the ones the policy has to name. */
const choosePacks = async ({ root, detection, old }: Migration): Promise<{ packs: string[]; namedPacks: string[] }> => {
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

  return { packs, namedPacks }
}

interface Levels {
  rules: Record<string, Level>
  changed: RuleChange[]
  importSorting: string[]
  added: string[]
  same: number
}

/** The rule levels the policy carries over: the ones that differ from the standard. */
const compareLevels = (old: Side, standard: Side, comparable: boolean, effective: Map<string, Level>): Levels => {
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

  return { rules, changed, importSorting: importSorting.sort(), added, same }
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

    // Only what the migration brought in: the standard's own gaps are for "pawl doctor" to report.
    const packTitles = new Set(packs.map(entry => `The ${getPack(entry)?.title} pack`))

    notEnforced = final.notEnforced.filter(item => item.rule in rules || packTitles.has(item.rule))

    for (const [name, resolved] of old.rules) {
      const mine = final.side.rules.get(name)
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

/** Read an existing ESLint flat config and work out the pawl policy that keeps its rules. */
export const planMigrate = async ({ root, keepConfig = false }: MigrateOptions): Promise<MigratePlan> => {
  const source = findSource(root)
  const eslint = await loadEslint(root, source)
  const detection = detect(root)
  const context: RuleContext = {
    typescript: detection.typescript,
    technologies: allTechnologies(detection),
    dependencies: detection.dependencies
  }
  const old = await resolveSide(new eslint.Reader({ cwd: root }), pickSamples(root, detection.typescript), eslint.core)

  if (old.samples.length === 0) throw new Error(`${source.name} does not apply to any file pawl could find.`)

  const notes: string[] = []
  const policyPath = join(root, 'pawl.config.ts')
  const migration: Migration = { root, detection, context, eslint, old, policyPath }
  const { packs, namedPacks } = await choosePacks(migration)
  let standard: Side = { rules: new Map(), formatting: new Map(), samples: [] }
  let comparable = true

  try {
    standard = (await pawlSide(migration, { packs })).side
  } catch (cause) {
    comparable = false
    notes.push(
      `Could not resolve the pawl standard through ESLint (${(cause as Error).message.split('\n')[0]}). Every plugin rule that is on was carried over as is.`
    )
  }

  const effective = effectiveRules(await resolvePolicy({ packs }, policyPath), context)
  const { rules, changed, importSorting, added, same } = compareLevels(old, standard, comparable, effective)
  const configured = readPrettier(root)
  // Prettier's CLI reads .editorconfig for what its own config leaves out.
  const prettier = configured && { ...readEditorconfig(root), ...configured }
  const style = styleFrom(old.formatting, prettier)

  if (detection.tools.prettier && !prettier) {
    notes.push(
      `Could not read the Prettier config in ${detection.tools.prettier}. Set "style" in the policy to match it, or "pawl fix" will format the code to the standard's style.`
    )
  }

  const read = source.legacy ? readLegacyIgnores(root) : await readIgnores(source.path)
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
      `Could not read the ignore patterns of ${source.name}. Add the folders to skip to "ignore" in the policy.`
    )

  const { options, biomeOptions, notEnforced } = await compareOptions(migration, policy, packs, rules)

  if (Object.keys(options).length > 0)
    policy.options = Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)))

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
    formatting,
    importSorting,
    packs,
    biomeOptions,
    notEnforced
  }
  const carried = [
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

  if (notEnforced.length > 0)
    notes.push(`${plural(notEnforced.length, 'rule or pack')} cannot run yet. See ${MIGRATION_REPORT}.`)

  return { ...summary, actions }
}
