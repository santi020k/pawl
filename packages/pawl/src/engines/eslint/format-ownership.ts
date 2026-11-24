/** Detect incompatible import-sort owners before any engine is allowed to write. */
import { join } from 'node:path'
import { type Project } from '../../policy/project.ts'
import { BIOME_CONFIG_FILES, firstExisting } from '../../project/config-files.ts'
import { makeIgnore } from '../../project/ignores.ts'
import { type SetupIssue } from '../../types.ts'
import { isRecord, readJsonc } from '../../utils/json.ts'
import { importFromProject } from './load.ts'

const SORT_RULES = new Set([
  'sort-imports',
  'import/order',
  'import-x/order',
  'simple-import-sort/imports',
  'simple-import-sort/exports',
  'perfectionist/sort-imports',
  'perfectionist/sort-exports'
])
interface EslintReader {
  calculateConfigForFile(file: string): Promise<unknown>
}
type EslintConstructor = new (options: { cwd: string }) => EslintReader
const enabled = (value: unknown): boolean => {
  const level: unknown = Array.isArray(value) ? value[0] : value
  return level === 1 || level === 2 || level === 'warn' || level === 'error'
}
const action = (value: unknown): 'on' | 'off' | undefined => {
  if (!isRecord(value)) return undefined
  if (value.enabled === false) return 'off'
  const actions = value.actions
  const source = isRecord(actions) ? actions.source : undefined
  if (!isRecord(source)) return undefined
  const level = source.organizeImports
  return level === 'on' || level === 'off' ? level : undefined
}
/** Resolve only public Pawl inheritance; custom inheritance may contain later scoped actions. */
const biomeOwners = (root: string): ((file: string) => 'on' | 'off' | 'unknown') => {
  const unknown = (): 'unknown' => 'unknown'
  const name = firstExisting(root, BIOME_CONFIG_FILES)
  if (!name) return unknown
  const { value } = readJsonc<unknown>(join(root, name))
  if (!isRecord(value)) return unknown
  const parents: unknown[] = Array.isArray(value.extends) ? value.extends : []
  if (value.extends !== undefined && !Array.isArray(value.extends)) return unknown
  if (parents.some(parent => typeof parent !== 'string' || !/^@santi020k\/pawl\/biome(?:\/|$)/.test(parent))) {
    return unknown
  }
  const includes = isRecord(value.files) ? value.files.includes : undefined
  const patterns =
    Array.isArray(includes) && includes.every((pattern: unknown) => typeof pattern === 'string')
      ? (includes as string[])
      : []
  // Only explicit negative global patterns establish an exclusion. Positive-only includes may
  // combine with inherited includes, so absence from them is not proof that Biome skips a file.
  const excluded = makeIgnore(
    patterns.map(pattern => (pattern.startsWith('!') ? pattern.replace(/^!+/, '') : `!${pattern}`))
  )
  const forced = makeIgnore(patterns.filter(pattern => pattern.startsWith('!!')).map(pattern => pattern.slice(2)))
  const scoped =
    Array.isArray(value.overrides) && value.overrides.some((item: unknown) => isRecord(item) && 'assist' in item)
  const owner = scoped ? 'unknown' : (action(value.assist) ?? (parents.length > 0 ? 'on' : 'unknown'))
  return file => (excluded(file) || forced(file) ? 'off' : owner)
}

export const formatterOwnership = async (project: Project, files: readonly string[]): Promise<SetupIssue[]> => {
  if (!project.tools.biome || !project.tools.eslint) return []
  const ownerFor = biomeOwners(project.root)
  const loaded = await importFromProject(project.root, 'eslint')
  if (!loaded.module) return [] // The engine's missing-tool diagnostic owns this case.
  const Constructor = loaded.module.ESLint
  if (typeof Constructor !== 'function') return []
  try {
    const reader = new (Constructor as EslintConstructor)({ cwd: project.root })
    const conflicts = new Map<string, { file: string; owner: 'on' | 'unknown' }>()
    for (const file of files.filter(path => /\.[cm]?[jt]sx?$|\.(?:astro|vue|svelte)$/.test(path))) {
      const owner = ownerFor(file)
      if (owner === 'off') continue
      const config = await reader.calculateConfigForFile(join(project.root, file))
      if (!isRecord(config) || !isRecord(config.rules)) continue
      for (const [rule, value] of Object.entries(config.rules)) {
        if (SORT_RULES.has(rule) && enabled(value) && !conflicts.has(rule)) conflicts.set(rule, { file, owner })
      }
    }
    return [...conflicts].map(([rule, { file, owner }]) => ({
      code: 'engine-failed',
      message:
        owner === 'on'
          ? `Competing import formatters: Biome organizeImports and ESLint ${rule} both own ${file}. No fixes were applied.`
          : `Cannot establish import formatter ownership for ${file}: ESLint ${rule} is enabled and Biome has custom or scoped source actions. No fixes were applied.`,
      fix: 'Choose one import-sort owner in the resolved configurations for these files. Keep semantic import checks. Use the same configuration for full checks and file-scoped hooks.'
    }))
  } catch (error) {
    return [
      {
        code: 'engine-failed',
        message: `Cannot inspect ESLint formatter ownership: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Repair the ESLint configuration, then run the check again. No fixes were applied.'
      }
    ]
  }
}
