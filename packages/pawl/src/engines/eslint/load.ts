/** Loading ESLint plugins the way the project would, and reading their presets. */

import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PACKS, type Pack } from '../../catalog/packs.ts'
import { resolveSpecifier } from '../../policy/load.ts'
import { isRecord } from '../../utils/json.ts'

export const TS_PREFIX = '@typescript-eslint'

/** Plugins whose package name does not follow the eslint-plugin-<prefix> convention. */
const PLUGIN_PACKAGES: Record<string, string> = {
  [TS_PREFIX]: 'typescript-eslint',
  vitest: '@vitest/eslint-plugin'
}

export const pluginPackage = (prefix: string): string => {
  const known = PLUGIN_PACKAGES[prefix] ?? PACKS.find(pack => pack.prefix === prefix)?.plugin

  if (known) return known

  return prefix.startsWith('@') ? `${prefix}/eslint-plugin` : `eslint-plugin-${prefix}`
}

export interface Loaded {
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
export const needs = (packageName: string, loaded: Loaded): string =>
  loaded.error ? `${packageName}, which is installed but failed to load: ${loaded.error}` : packageName

export type RuleValue = unknown

export type Rules = Record<string, RuleValue>

/** Read the rules out of a plugin preset: a rules object, a flat config, or a list of flat configs. */
export const presetRules = (value: unknown): Rules => {
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

export const presetOf = (pack: Pack, plugin: Record<string, unknown>): unknown =>
  (pack.preset ?? []).reduce<unknown>(
    (value, key) => (isRecord(value) ? value[key] : undefined),
    pack.preset ? plugin : undefined
  )

/** The rules of one of a plugin's own presets, by name. Only the plugin's own rules: a preset may also switch core rules off. */
export const pluginPreset = (plugin: Record<string, unknown>, name: string, prefix: string): Rules | undefined => {
  const configs = isRecord(plugin.configs) ? plugin.configs : {}
  const found = configs[name] ?? configs[`flat/${name}`]

  if (found === undefined) return undefined

  return Object.fromEntries(Object.entries(presetRules(found)).filter(([rule]) => rule.startsWith(`${prefix}/`)))
}
