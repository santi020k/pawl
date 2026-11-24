/** Carry flat-config rule scopes without inferring their meaning from today's files. */

import { pathToFileURL } from 'node:url'
import { canonicalName, getRule } from '../../catalog/rules.ts'
import { type OverrideInput } from '../../types.ts'
import { isRecord, sameJson } from '../../utils/json.ts'
import { type CoreRules, type EslintConfig, IMPORT_SORTING, isFormatting, rank, type Side, toLevel } from './read.ts'

interface Block {
  files: string[] | undefined
  rules: Record<string, unknown>
  config: EslintConfig
}

export interface MigrationScopes {
  names: Set<string>
  overrides: OverrideInput[]
  /** Raw names, including rules whose scopes have no files yet, used to find the required packs. */
  rules: Side['rules']
}

const refuse = (reason: string): never => {
  throw new Error(
    `Cannot preserve ESLint file scopes: ${reason}. Simplify the config before migrating; no files were written.`
  )
}

/** Keep the core/type-aware names distinct when the catalog does not alias them. */
const policyName = (name: string): string => canonicalName(name)

const patterns = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) return refuse('files must be a nonempty array of glob strings')

  return value.map((pattern: unknown) => {
    if (typeof pattern !== 'string' || pattern.length === 0)
      return refuse('AND or function file matchers are not supported')

    // These forms either differ across engines or have a different meaning in pawl's policy.
    if (/^[!/#]|\\|\[|\]|[()]|\{[^{}]*\.\./.test(pattern) || pattern.split('/').includes('..'))
      return refuse(`the file pattern "${pattern}" is not a portable glob`)

    // ESLint's bare *.js is rooted; pawl's bare *.js matches at every depth.
    return `/${pattern.replace(/^\.\//, '')}`
  })
}

const flatten = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => flatten(item))

  if (!isRecord(value)) return refuse('the flat config must export config objects')

  return [value]
}

const pluginContext = (configs: readonly Record<string, unknown>[]): EslintConfig => {
  const plugins: NonNullable<EslintConfig['plugins']> = {}

  for (const config of configs) {
    if (!isRecord(config.plugins)) continue

    for (const [name, plugin] of Object.entries(config.plugins)) {
      if (!isRecord(plugin) || !isRecord(plugin.rules)) continue

      const rules: NonNullable<NonNullable<EslintConfig['plugins']>[string]['rules']> = {}

      for (const [ruleName, rule] of Object.entries(plugin.rules)) {
        if (!isRecord(rule) || !isRecord(rule.meta) || typeof rule.meta.type !== 'string') continue

        rules[ruleName] = { meta: { type: rule.meta.type } }
      }

      plugins[name] = { rules }
    }
  }

  return { plugins }
}

/**
 * Only rules touched by a scope need ordered replay. Unrelated global rules retain the existing
 * minimal-difference migration. Source options are explicit, including [] to avoid catalog defaults.
 */
export const readMigrationScopes = async (
  path: string,
  legacy: string | undefined,
  core: CoreRules
): Promise<MigrationScopes> => {
  if (legacy)
    return refuse(`legacy configuration ${legacy} must first be converted to flat config with @eslint/migrate-config`)

  const loaded: unknown = await import(pathToFileURL(path).href)

  if (!isRecord(loaded)) return refuse('the config module could not be read')

  const configs = flatten(await loaded.default)
  const context = pluginContext(configs)
  const blocks: Block[] = []
  const names = new Set<string>()
  const rules: Side['rules'] = new Map()

  for (const config of configs) {
    if ('extends' in config) return refuse('unexpanded extends requires ESLint defineConfig()')

    const ownRules = isRecord(config.rules) ? config.rules : {}
    const localIgnores = 'ignores' in config && Object.keys(config).some(key => key !== 'ignores' && key !== 'name')
    const scoped = 'files' in config || 'basePath' in config || localIgnores

    if (scoped && ('basePath' in config || 'ignores' in config))
      return refuse('basePath and local ignores are not supported')

    if (scoped && ['languageOptions', 'linterOptions', 'settings', 'processor'].some(key => key in config))
      return refuse('scoped languageOptions, linterOptions, settings and processors need manual migration')

    const files = 'files' in config ? patterns(config.files) : undefined

    for (const [name, value] of Object.entries(ownRules)) {
      const formatting = isFormatting(name, context, core) || IMPORT_SORTING.has(name)

      if (files && formatting) return refuse(`scoped formatting or import sorting rule ${name} needs manual migration`)

      if (formatting) continue

      const resolved = { level: toLevel(value), options: Array.isArray(value) ? (value.slice(1) as unknown[]) : [] }
      const previous = rules.get(name)

      if (!previous || rank(resolved.level) > rank(previous.level)) rules.set(name, resolved)

      if (files) names.add(policyName(name))
    }

    blocks.push({ files, rules: ownRules, config: context })
  }

  const overrides: OverrideInput[] = []
  const inherited = new Map<string, Array<{ files: string[] | undefined; options: unknown[] }>>()
  const rawNames = new Map<string, string>()

  for (const block of blocks) {
    const levels: NonNullable<OverrideInput['rules']> = {}
    const options: NonNullable<OverrideInput['options']> = {}

    for (const [raw, value] of Object.entries(block.rules)) {
      const name = policyName(raw)

      if (!names.has(name)) continue

      const severity: unknown = Array.isArray(value) ? value[0] : value

      if (
        severity !== 0 &&
        severity !== 1 &&
        severity !== 2 &&
        severity !== 'off' &&
        severity !== 'warn' &&
        severity !== 'error'
      )
        return refuse(`the rule ${raw} has an invalid severity`)

      const previousName = rawNames.get(name)

      if (previousName && previousName !== raw)
        return refuse(`the aliases ${previousName} and ${raw} share a scoped rule`)

      rawNames.set(name, raw)

      if (isFormatting(raw, block.config, core) || IMPORT_SORTING.has(raw)) continue

      const previous = inherited.get(name) ?? []
      const explicit = Array.isArray(value) && value.length > 1
      let given: unknown[] = explicit && Array.isArray(value) ? (value.slice(1) as unknown[]) : []

      if (!explicit && previous.length > 0) {
        const last = previous.at(-1)

        if (last) {
          const identical = previous.every(entry => sameJson(entry.options, last.options))
          const sameScope = sameJson(last.files, block.files)
          const globalOnly = previous.every(entry => entry.files === undefined)

          if (!identical && !sameScope && !globalOnly)
            return refuse(`severity-only ${raw} inherits different options across overlapping scopes`)

          given = last.options

          // An earlier scoped value is not inherited by files outside that scope.
          if (!sameScope && !globalOnly && !sameJson(given, []))
            return refuse(`severity-only ${raw} inherits scoped options outside its scope`)
        }
      }

      levels[name] = toLevel(value)
      options[name] = given

      const entry = { files: block.files, options: given }
      inherited.set(name, block.files === undefined ? [entry] : [...previous, entry])
    }

    if (Object.keys(levels).length > 0) overrides.push({ files: block.files ?? ['**/*'], rules: levels, options })
  }

  // A catalog rule's alias can otherwise be enabled globally when its scope was replayed above.
  for (const name of names) {
    const def = getRule(name)

    if (def) names.add(def.name)
  }

  return { names, overrides, rules }
}
