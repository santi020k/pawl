import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalName, defaultLevel, getRule, isGated, RULES, type Technology } from '../catalog/rules.ts'
import { literalBrackets } from '../project/ignores.ts'
import { ESLINT_CONFIG_FILES } from '../project/toolset.ts'
import { type Level, type Override, type Policy, type PolicyInput, type StyleOptions } from '../types.ts'
import { ancestors, toList } from '../utils/fs.ts'
import { POLICY_KEYS } from './schema.ts'

export const DEFAULT_STYLE: StyleOptions = {
  indent: 2,
  lineWidth: 120,
  quotes: 'single',
  semicolons: false,
  trailingCommas: 'none',
  arrowParens: 'as-needed'
}

export const CONFIG_FILES = [
  'pawl.config.ts',
  'pawl.config.mts',
  'pawl.config.js',
  'pawl.config.mjs',
  'pawl.config.json'
]

const ORDER: Record<Level, number> = { off: 0, warn: 1, error: 2 }

const MAX_DEPTH = 10

/** Identity helper that gives `pawl.config.ts` and policy packages their types. */
export const definePolicy = (policy: PolicyInput): PolicyInput => policy

export interface Layer {
  input: PolicyInput
  source: string
}

const emptyPolicy = (): Policy => ({
  engine: 'auto',
  formatter: 'auto',
  packs: [],
  strict: false,
  style: { ...DEFAULT_STYLE },
  rules: {},
  options: {},
  biomeOptions: {},
  overrides: [],
  locked: [],
  ignore: [],
  gitignore: true,
  defaultIgnores: true,
  runtime: undefined,
  detect: { enabled: true, exclude: [] },
  maxWarnings: undefined,
  lockViolations: [],
  sources: ['pawl defaults']
})

/**
 * Merge policy layers, earliest first. Later layers win, with two exceptions that keep a
 * company standard enforceable: `strict` can be turned on but not off, and a locked rule
 * can be tightened but not loosened.
 */
export const mergeLayers = (layers: readonly Layer[]): Policy => {
  const policy = emptyPolicy()

  for (const { input, source } of layers) {
    policy.sources.push(source)

    if (input.engine) policy.engine = input.engine

    if (input.formatter) policy.formatter = input.formatter

    for (const pack of input.packs ?? []) {
      if (!policy.packs.includes(pack)) policy.packs.push(pack)
    }

    if (input.strict) policy.strict = true

    if (input.style) policy.style = { ...policy.style, ...input.style }

    if (input.maxWarnings !== undefined) {
      policy.maxWarnings = Math.min(policy.maxWarnings ?? Number.POSITIVE_INFINITY, input.maxWarnings)
    }

    for (const [given, level] of Object.entries(input.rules ?? {})) {
      const name = canonicalName(given)
      const kept = lockedLevel(policy, name, level)

      if (kept === undefined) policy.rules[name] = level
      else policy.lockViolations.push({ rule: name, wanted: level, kept, source })
    }

    for (const [given, value] of Object.entries(input.options ?? {})) policy.options[canonicalName(given)] = [...value]

    Object.assign(policy.biomeOptions, biomeOptionsOf(input.biomeOptions, source))

    for (const given of input.locked ?? []) {
      const name = canonicalName(given)

      if (!policy.locked.includes(name)) policy.locked.push(name)
    }

    for (const pattern of (input.ignore ?? []).map(literalBrackets)) {
      if (!policy.ignore.includes(pattern)) policy.ignore.push(pattern)
    }

    for (const override of input.overrides ?? []) policy.overrides.push(mergeOverride(policy, override, source))

    if (input.gitignore !== undefined) policy.gitignore = input.gitignore

    if (input.defaultIgnores !== undefined) policy.defaultIgnores = input.defaultIgnores

    if (input.runtime !== undefined) policy.runtime = [...new Set(toList(input.runtime))]

    if (input.detect === false || input.detect === true) policy.detect = { ...policy.detect, enabled: input.detect }
    else if (input.detect) {
      policy.detect = {
        enabled: true,
        exclude: [...new Set([...policy.detect.exclude, ...(input.detect.exclude ?? [])])]
      }
    }
  }

  requireLevels(policy)

  return policy
}

const BIOME_ONLY = 'biome:'

/**
 * Options for Biome by canonical rule name. Biome refuses options for a rule it does not have,
 * so a name without a Biome rule is refused here, where the message can say which policy named it.
 */
const biomeOptionsOf = (
  input: Record<string, Record<string, unknown>> | undefined,
  source: string
): Record<string, Record<string, unknown>> => {
  const out: Record<string, Record<string, unknown>> = {}

  for (const [given, value] of Object.entries(input ?? {})) {
    const name = canonicalName(given)

    if (!isRecord(value)) {
      throw new Error(
        `${source} gives "${given}" Biome options that are not an object. Use Biome's own shape: { ... }.`
      )
    }

    if (!name.startsWith(BIOME_ONLY) && !getRule(name)?.biome) {
      throw new Error(
        `${source} gives Biome options to "${given}", which Biome does not enforce. Use \`options\` for ESLint and Oxlint, or name Biome's rule as biome:group/name.`
      )
    }

    out[name] = { ...value }
  }

  return out
}

/** A rule only Biome has is off until the policy gives it a level, so options alone would do nothing. */
const requireLevels = (policy: Policy): void => {
  const named = [policy.biomeOptions, ...policy.overrides.map(override => override.biomeOptions)].flatMap(Object.keys)
  const leveled = (name: string): boolean =>
    name in policy.rules || policy.overrides.some(override => name in override.rules && name in override.biomeOptions)
  const missing = [...new Set(named)].filter(name => name.startsWith(BIOME_ONLY) && !leveled(name))

  if (missing.length > 0) {
    throw new Error(
      `The policy gives Biome options to ${missing.join(', ')} but no level. Add ${missing.length === 1 ? 'it' : 'them'} to \`rules\`, for example '${missing[0]}': 'error'.`
    )
  }
}

/**
 * The level a locked rule keeps when a layer asks for a looser one, or undefined when the
 * asked-for level is allowed. The rule's own default, or the level a layer set, is the floor.
 */
const lockedLevel = (policy: Policy, name: string, wanted: Level): Level | undefined => {
  const current = policy.rules[name] ?? defaultLevel(name, policy.strict)

  return policy.locked.includes(name) && ORDER[wanted] < ORDER[current] ? current : undefined
}

/** An override with rule names made canonical. A locked rule cannot be loosened for some files either. */
const mergeOverride = (
  policy: Policy,
  override: NonNullable<PolicyInput['overrides']>[number],
  source: string
): Override => {
  const rules: Record<string, Level> = {}

  for (const [given, level] of Object.entries(override.rules ?? {})) {
    const name = canonicalName(given)
    const kept = lockedLevel(policy, name, level)

    rules[name] = kept ?? level

    if (kept !== undefined)
      policy.lockViolations.push({ rule: name, wanted: level, kept, source: `${source} (overrides)` })
  }

  const options = Object.fromEntries(
    Object.entries(override.options ?? {}).map(([given, value]) => [canonicalName(given), [...value]])
  )

  return {
    files: override.files.map(literalBrackets),
    rules,
    options,
    biomeOptions: biomeOptionsOf(override.biomeOptions, `${source} (overrides)`)
  }
}

/** The policy with no config at all. */
export const defaultPolicy = (): Policy => mergeLayers([])

export interface RuleContext {
  typescript?: boolean
  /** The technologies the project uses. Rules for any other technology are left out. */
  technologies?: readonly Technology[]
  /** Every dependency in the repo. Switches on the guards for the libraries it uses. */
  dependencies?: readonly string[]
}

/**
 * The level of every rule: catalog defaults, then the policy's overrides.
 * With a context, rules for technology the project does not use are left out.
 */
export const effectiveRules = (policy: Policy, context?: RuleContext): Map<string, Level> => {
  const levels = new Map<string, Level>()

  for (const def of RULES) {
    if (ruleApplies(def.name, context)) levels.set(def.name, defaultLevel(def.name, policy.strict))
  }

  for (const [name, level] of Object.entries(policy.rules)) {
    if (ruleApplies(name, context)) levels.set(name, level)
  }

  return levels
}

/** True when a rule applies to a project: always without a context, else when the project uses its technology. */
export const ruleApplies = (name: string, context?: RuleContext): boolean => {
  const def = getRule(name)

  if (!context || !def) return true

  if (def.tag === 'typescript') return context.typescript === true

  return !isGated(def.tag) || (context.technologies ?? []).includes(def.tag)
}

/**
 * The rules of one override that apply to the project, in the order the override names them.
 * A rule the override gives options but no level keeps the level it has, unless that is off.
 */
export const overrideRules = (override: Override, context?: RuleContext, policy?: Policy): [string, Level][] => {
  const levels = policy ? effectiveRules(policy, context) : new Map<string, Level>()
  const optionsOnly = Object.keys(override.options).flatMap((name): [string, Level][] => {
    const level = levels.get(name)

    return name in override.rules || level === undefined || level === 'off' ? [] : [[name, level]]
  })

  return [...Object.entries(override.rules).filter(([name]) => ruleApplies(name, context)), ...optionsOnly]
}

export const findConfigFile = (root: string): string | undefined =>
  CONFIG_FILES.map(name => join(root, name)).find(file => existsSync(file))

/**
 * The project root for a start directory, such as the folder an editor started ESLint in.
 * The nearest folder with a pawl config wins; without one anywhere above, the nearest with an
 * ESLint flat config, then the nearest with a package.json. Else the start directory itself.
 */
export const findProjectRoot = (start: string): string => {
  const dirs = ancestors(start)
  const has = (names: readonly string[]) => (dir: string) => names.some(name => existsSync(join(dir, name)))

  return (
    dirs.find(has(CONFIG_FILES)) ??
    dirs.find(has(ESLINT_CONFIG_FILES)) ??
    dirs.find(has(['package.json'])) ??
    resolve(start)
  )
}

/** Resolve a package or path the way the file that names it would, including packages that only offer ESM. */
export const resolveSpecifier = (specifier: string, fromFile: string): string => {
  if (specifier.startsWith('.') || isAbsolute(specifier)) return resolve(dirname(fromFile), specifier)

  try {
    return createRequire(fromFile).resolve(specifier)
  } catch (cause) {
    // Packages that only declare an "import" condition cannot be resolved with require.
    const manifestPath = findManifest(specifier, fromFile)

    if (!manifestPath) {
      throw new Error(`Cannot find "${specifier}" (needed by ${fromFile}). Is it installed?`, { cause })
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: unknown; main?: string }
    const entry = pickEntry(manifest.exports) ?? manifest.main ?? 'index.js'

    return resolve(dirname(manifestPath), entry)
  }
}

const findManifest = (specifier: string, fromFile: string): string | undefined => {
  try {
    return findPackageJSON(specifier, pathToFileURL(fromFile))
  } catch {
    return undefined
  }
}

const pickEntry = (exportsField: unknown): string | undefined => {
  if (typeof exportsField === 'string') return exportsField

  if (!exportsField || typeof exportsField !== 'object') return undefined

  const record = exportsField as Record<string, unknown>
  const root = '.' in record ? record['.'] : record

  if (typeof root === 'string') return root

  if (!root || typeof root !== 'object') return undefined

  const conditions = root as Record<string, unknown>

  for (const key of ['import', 'default', 'node']) {
    const value = conditions[key]
    const nested = typeof value === 'string' ? value : pickEntry(value)

    if (nested) return nested
  }

  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Refuse a policy with keys pawl does not know, so a typo does not pass in silence. */
const validate = (value: unknown, source: string): PolicyInput => {
  if (!isRecord(value)) throw new Error(`${source} must be an object: export default definePolicy({ ... })`)

  const unknown = Object.keys(value).filter(key => !(POLICY_KEYS as readonly string[]).includes(key))

  if (unknown.length > 0) {
    throw new Error(
      `${source} has ${unknown.length === 1 ? 'an option' : 'options'} pawl does not know: ${unknown.join(', ')}. The options are: ${POLICY_KEYS.filter(key => key !== '$schema').join(', ')}.`
    )
  }

  return value as PolicyInput
}

const loadFile = async (file: string): Promise<PolicyInput> => {
  if (!existsSync(file)) throw new Error(`Policy file not found: ${file}`)

  if (file.endsWith('.json')) return validate(JSON.parse(readFileSync(file, 'utf8')) as unknown, file)

  // The mtime keeps a long-lived process, such as an editor, from reusing a stale module.
  const url = `${pathToFileURL(file).href}?mtime=${statSync(file).mtimeMs}`
  const loaded = (await import(url)) as { default?: unknown }

  if (!loaded.default || typeof loaded.default !== 'object') {
    throw new Error(`${file} must have a default export: export default definePolicy({ ... })`)
  }

  return validate(loaded.default, file)
}

const collectLayers = async (input: PolicyInput, source: string, fromFile: string, depth: number): Promise<Layer[]> => {
  if (depth > MAX_DEPTH)
    throw new Error(`Policy "extends" is nested more than ${MAX_DEPTH} levels deep at ${source}. Is there a cycle?`)

  const parents = toList<string | PolicyInput>(input.extends)
  const layers: Layer[] = []

  for (const parent of parents) {
    if (typeof parent === 'string') {
      const file = resolveSpecifier(parent, fromFile)

      layers.push(...(await collectLayers(await loadFile(file), parent, file, depth + 1)))
    } else {
      layers.push(
        ...(await collectLayers(validate(parent, `${source} (inline)`), `${source} (inline)`, fromFile, depth + 1))
      )
    }
  }

  layers.push({ input, source })

  return layers
}

/** Turn a policy input into a merged policy, following every `extends`. */
export const resolvePolicy = async (input: PolicyInput, fromFile: string, source = 'inline policy'): Promise<Policy> =>
  mergeLayers(await collectLayers(validate(input, source), source, fromFile, 0))

/** Load the project's policy. Without a config file this is the default standard. */
export const loadPolicy = async (root: string): Promise<Policy> => {
  const file = findConfigFile(root)

  if (!file) return defaultPolicy()

  return resolvePolicy(await loadFile(file), file, file.slice(root.length + 1))
}
