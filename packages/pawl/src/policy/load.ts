import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GUARDS, getGuard } from '../catalog/guards.ts'
import { getPack, PACKS } from '../catalog/packs.ts'
import { ESLINT_CONFIG_FILES, hasAny, PAWL_CONFIG_FILES } from '../project/config-files.ts'
import { type Policy, type PolicyInput } from '../types.ts'
import { ancestors } from '../utils/fs.ts'
import { isRecord } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { defaultPolicy, type Layer, mergeLayers } from './merge.ts'
import { POLICY_KEYS, policyProblems } from './schema.ts'

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

/** Read a package manifest without allowing a test runner's resolver to substitute ambient packages. */
const manifestAt = (path: string): Record<string, unknown> | undefined => {
  if (!existsSync(path)) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(value)) throw new Error(`Invalid package manifest: ${path}`)
  return value
}

const packageManifest = (
  name: string,
  fromFile: string
): { path: string; value: Record<string, unknown> } | undefined => {
  const dirs = ancestors(dirname(fromFile))
  // Node self references resolve only within the nearest package scope, and require exports.
  const scope = dirs.map(dir => join(dir, 'package.json')).find(path => existsSync(path))
  const self = scope ? manifestAt(scope) : undefined
  if (scope && self?.name === name && 'exports' in self) return { path: scope, value: self }
  for (const dir of dirs) {
    const path = join(dir, 'node_modules', name, 'package.json')
    const value = manifestAt(path)
    if (value) return { path, value }
  }
  return undefined
}

/** NODE_OPTIONS uses double-quoted strings; single quotes are literal characters. */
const environmentOptions = (value: string): string[] => {
  const tokens: string[] = []
  let token = ''
  let quoted = false
  let started = false
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (character === undefined) break
    if (character === '\\' && quoted) {
      const next = value[++index]
      if (next === undefined)
        throw new Error('Cannot determine public export conditions: incomplete NODE_OPTIONS escape.')
      token += next
      started = true
    } else if (character === '"') {
      quoted = !quoted
      started = true
    } else if (character === ' ' && !quoted) {
      if (started) tokens.push(token)
      token = ''
      started = false
    } else {
      if (!quoted && /\s/.test(character))
        throw new Error('Cannot determine public export conditions: unsupported NODE_OPTIONS whitespace.')
      token += character
      started = true
    }
  }
  if (quoted) throw new Error('Cannot determine public export conditions: unterminated NODE_OPTIONS string.')
  if (started) tokens.push(token)
  return tokens
}

// These options consume the next token even when that token resembles a condition flag.
const VALUE_OPTIONS = new Set([
  '-e',
  '--eval',
  '-p',
  '--print',
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '--input-type',
  '--title',
  '--icu-data-dir',
  '--openssl-config',
  '--redirect-warnings',
  '--diagnostic-dir',
  '--trace-event-categories',
  '--trace-event-file-pattern',
  '--watch-path',
  '--env-file',
  '--env-file-if-exists',
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--heap-prof-dir',
  '--heap-prof-name',
  '--cpu-prof-dir',
  '--cpu-prof-name',
  '--snapshot-blob',
  '--build-snapshot-config',
  '--tls-cipher-list',
  '--experimental-policy',
  '--policy-integrity'
])

// Capture startup inputs before callers can mutate process.env or process.execArgv.
const RUNTIME_OPTIONS = process.env.NODE_OPTIONS ?? ''
const RUNTIME_ARGUMENTS = [...process.execArgv]
const REQUIRE_MODULE = process.features.require_module
const BOOLEAN_OPTIONS = new Set([
  '--experimental-require-module',
  '--no-experimental-require-module',
  '--experimental-strip-types',
  '--no-experimental-strip-types',
  '--experimental-import-meta-resolve',
  '--no-experimental-import-meta-resolve',
  '--no-warnings',
  '--warnings',
  '--no-deprecation',
  '--trace-warnings',
  '--trace-deprecation',
  '--enable-source-maps',
  '--no-enable-source-maps'
])
const conditionOption = (value: string | undefined): boolean =>
  value !== undefined && /^(?:--(?:conditions|(?:no[-_])?addons)(?:=|$)|-C)/.test(value)

const importConditions = (): ReadonlySet<string> => {
  const conditions = new Set(['node', 'import', 'default'])
  if (REQUIRE_MODULE) conditions.add('module-sync')
  let addons = true
  const custom: string[] = []
  const args = [...environmentOptions(RUNTIME_OPTIONS), ...RUNTIME_ARGUMENTS]
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === undefined) break
    const equal = argument.indexOf('=')
    const flag = (equal < 0 ? argument : argument.slice(0, equal)).replaceAll('_', '-')
    if (flag === '--experimental-config-file' || flag === '--experimental-default-config-file')
      throw new Error(
        'Cannot determine public export conditions from experimental Node configuration files. Pass conditions explicitly on the command line or in NODE_OPTIONS.'
      )
    if (flag === '-C' && equal >= 0)
      throw new Error('Cannot determine public export conditions: unsupported short condition option syntax.')
    if (flag === '--conditions' || flag === '-C') {
      const value = equal < 0 ? args[++index] : argument.slice(equal + 1)
      if (!value) throw new Error('Cannot determine public export conditions: a condition value is missing.')
      custom.push(value)
    } else if (flag === '--no-addons') addons = false
    else if (flag === '--addons') addons = true
    else if (equal < 0 && VALUE_OPTIONS.has(flag)) index++
    else if (flag.startsWith('-C') || flag.startsWith('--conditions'))
      throw new Error('Cannot determine public export conditions: unsupported condition option syntax.')
    else if (equal < 0 && flag.startsWith('-') && !BOOLEAN_OPTIONS.has(flag) && conditionOption(args[index + 1]))
      throw new Error(
        'Cannot determine public export conditions: an unknown option may consume the following condition flag. Use an explicit option=value form.'
      )
  }
  if (addons) conditions.add('node-addons')
  for (const condition of custom) conditions.add(condition)
  return conditions
}

/** Node selects recognized export conditions in declaration order, not a fixed preference order. */
const importTarget = (value: unknown, conditions: ReadonlySet<string>): string | null | undefined => {
  if (typeof value === 'string' || value === null) return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = importTarget(candidate, conditions)
      if (target !== undefined && target !== null) return target
    }
    return null
  }
  if (!isRecord(value)) return undefined
  for (const [condition, target] of Object.entries(value)) {
    if (!conditions.has(condition)) continue
    const resolved = importTarget(target, conditions)
    if (resolved !== undefined) return resolved
  }
  return undefined
}

/** Resolve public, concrete package exports for dynamic import; never fall through a denied export to main. */
export const resolveSpecifier = (specifier: string, fromFile: string): string => {
  if (specifier.startsWith('.') || isAbsolute(specifier)) return resolve(dirname(fromFile), specifier)
  if (specifier.startsWith('#')) return createRequire(fromFile).resolve(specifier)
  const parts = specifier.split('/')
  const length = specifier.startsWith('@') ? 2 : 1
  const name = parts.slice(0, length).join('/')
  const subpath = parts.length === length ? '.' : `./${parts.slice(length).join('/')}`
  const manifest = packageManifest(name, fromFile)
  if (!manifest) throw new Error(`Cannot find "${specifier}" (needed by ${fromFile}). Is it installed?`)
  if (!('exports' in manifest.value)) return createRequire(fromFile).resolve(specifier)
  const exportsField = manifest.value.exports
  let selection: unknown = subpath === '.' ? exportsField : undefined
  if (isRecord(exportsField) && Object.keys(exportsField).some(key => key.startsWith('.'))) {
    if (Object.keys(exportsField).some(key => !key.startsWith('.')))
      throw new Error(`Invalid mixed exports in ${name}.`)
    selection = exportsField[subpath]
    if (selection === undefined && Object.keys(exportsField).some(key => key.includes('*')))
      throw new Error(`Pattern exports for "${specifier}" require an explicit public entry; no private path was used.`)
  }
  const target = importTarget(selection, importConditions())
  if (typeof target !== 'string') throw new Error(`Package "${name}" does not export "${subpath}" for import.`)
  if (
    !target.startsWith('./') ||
    /[%\\]/.test(target) ||
    target
      .slice(2)
      .split('/')
      .some(part => part === '..' || part === '.' || part === 'node_modules') ||
    target.includes('*')
  )
    throw new Error(`Unsupported or unsafe export target for "${specifier}".`)
  // Package dependencies resolve beside the installed target, not a workspace's symlink to it.
  return realpathSync(resolve(dirname(manifest.path), target))
}

/**
 * A JS or TS policy can set an option to undefined, as in `maxWarnings: ci ? 0 : undefined`, and
 * means it is not set. Leaving such keys out of plain objects, at any depth, lets the checks and the
 * merge read them that way. JSON cannot say undefined, so a JSON policy is unchanged.
 */
const withoutUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUndefined)

  if (!isRecord(value)) return value

  const prototype = Object.getPrototypeOf(value) as unknown

  if (prototype !== Object.prototype && prototype !== null) return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)])
  )
}

/** Refuse a policy with keys pawl does not know, so a typo does not pass in silence. */
const validate = (given: unknown, source: string): PolicyInput => {
  const value = withoutUndefined(given)

  if (!isRecord(value)) throw new Error(`${source} must be an object: export default definePolicy({ ... })`)

  const unknown = Object.keys(value).filter(key => !(POLICY_KEYS as readonly string[]).includes(key))

  if (unknown.length > 0) {
    throw new Error(
      `${source} has ${unknown.length === 1 ? 'an option' : 'options'} pawl does not know: ${unknown.join(', ')}. The options are: ${POLICY_KEYS.filter(key => key !== '$schema').join(', ')}.`
    )
  }

  const problems = [...policyProblems(value), ...unknownPacks(value.packs)]

  if (problems.length > 0) {
    throw new Error(
      problems.length === 1
        ? `${source} has a value pawl cannot use: ${problems[0]}`
        : `${source} has values pawl cannot use:\n${problems.map(problem => `  ${problem}`).join('\n')}`
    )
  }

  return value as PolicyInput
}

/** A pack name with a typo would switch nothing on and say nothing, so it is refused like an unknown key. */
const unknownPacks = (packs: unknown): string[] => {
  const names = Array.isArray(packs) ? packs.filter((name): name is string => typeof name === 'string') : []
  const unknown = names.filter(name => !getPack(name) && !getGuard(name)?.optIn)

  return unknown.length > 0
    ? [
        `"packs" names ${unknown.map(name => `"${name}"`).join(', ')}, which ${unknown.length === 1 ? 'is not a pack' : 'are not packs'}. The packs are: ${[...PACKS.map(pack => pack.name), ...GUARDS.filter(guard => guard.optIn).map(guard => guard.name)].join(', ')}.`
      ]
    : []
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
