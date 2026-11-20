import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ESLINT_CONFIG_FILES, hasAny, PAWL_CONFIG_FILES } from '../project/config-files.ts'
import { type Policy, type PolicyInput } from '../types.ts'
import { ancestors } from '../utils/fs.ts'
import { isRecord } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { defaultPolicy, type Layer, mergeLayers } from './merge.ts'
import { POLICY_KEYS } from './schema.ts'

const MAX_DEPTH = 10

export const findConfigFile = (root: string): string | undefined =>
  PAWL_CONFIG_FILES.map(name => join(root, name)).find(file => existsSync(file))

/**
 * The project root for a start directory, such as the folder an editor started ESLint in.
 * The nearest folder with a pawl config wins; without one anywhere above, the nearest with an
 * ESLint flat config, then the nearest with a package.json. Else the start directory itself.
 */
export const findProjectRoot = (start: string): string => {
  const dirs = ancestors(start)
  const has = (names: readonly string[]) => (dir: string) => hasAny(dir, names)

  return (
    dirs.find(has(PAWL_CONFIG_FILES)) ??
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
