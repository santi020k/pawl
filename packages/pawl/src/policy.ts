import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toList } from './fs-utils.ts'
import { canonicalName, defaultLevel, getRule, isGated, RULES, type Technology } from './rules.ts'
import { type Level, type Policy, type PolicyInput, type StyleOptions } from './types.ts'

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
  locked: [],
  ignore: [],
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

    for (const [given, level] of Object.entries(input.rules ?? {})) {
      // An alias, such as the TypeScript twin of a core rule, sets the rule it stands for.
      const name = canonicalName(given)
      const current = policy.rules[name] ?? defaultLevel(name, policy.strict)

      if (policy.locked.includes(name) && ORDER[level] < ORDER[current]) {
        policy.lockViolations.push({ rule: name, wanted: level, kept: current, source })

        continue
      }

      policy.rules[name] = level
    }

    for (const [given, value] of Object.entries(input.options ?? {})) policy.options[canonicalName(given)] = [...value]

    for (const given of input.locked ?? []) {
      const name = canonicalName(given)

      if (!policy.locked.includes(name)) policy.locked.push(name)
    }

    for (const pattern of input.ignore ?? []) {
      if (!policy.ignore.includes(pattern)) policy.ignore.push(pattern)
    }
  }

  return policy
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
  const applies = (name: string): boolean => {
    const def = getRule(name)

    if (!context || !def) return true

    if (def.tag === 'typescript') return context.typescript === true

    return !isGated(def.tag) || (context.technologies ?? []).includes(def.tag)
  }

  for (const def of RULES) {
    if (applies(def.name)) levels.set(def.name, defaultLevel(def.name, policy.strict))
  }

  for (const [name, level] of Object.entries(policy.rules)) {
    if (applies(name)) levels.set(name, level)
  }

  return levels
}

export const findConfigFile = (root: string): string | undefined =>
  CONFIG_FILES.map(name => join(root, name)).find(file => existsSync(file))

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

const loadFile = async (file: string): Promise<PolicyInput> => {
  if (!existsSync(file)) throw new Error(`Policy file not found: ${file}`)

  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8')) as PolicyInput

  // The mtime keeps a long-lived process, such as an editor, from reusing a stale module.
  const url = `${pathToFileURL(file).href}?mtime=${statSync(file).mtimeMs}`
  const loaded = (await import(url)) as { default?: PolicyInput }

  if (!loaded.default || typeof loaded.default !== 'object') {
    throw new Error(`${file} must have a default export: export default definePolicy({ ... })`)
  }

  return loaded.default
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
      layers.push(...(await collectLayers(parent, `${source} (inline)`, fromFile, depth + 1)))
    }
  }

  layers.push({ input, source })

  return layers
}

/** Turn a policy input into a merged policy, following every `extends`. */
export const resolvePolicy = async (input: PolicyInput, fromFile: string, source = 'inline policy'): Promise<Policy> =>
  mergeLayers(await collectLayers(input, source, fromFile, 0))

/** Load the project's policy. Without a config file this is the default standard. */
export const loadPolicy = async (root: string): Promise<Policy> => {
  const file = findConfigFile(root)

  if (!file) return defaultPolicy()

  return resolvePolicy(await loadFile(file), file, file.slice(root.length + 1))
}
