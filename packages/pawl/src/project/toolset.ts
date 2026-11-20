import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type EngineName, type FormatterName, type Policy } from '../types.ts'

export const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cjs'
]

export const PRETTIER_CONFIG_FILES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.cjs'
]

/** Which tools do what in a project. Every one of them is the project's own choice. */
export interface Toolset {
  /** The engine that enforces the standard's lint rules. */
  linter: EngineName
  formatter: FormatterName
  /** Biome runs, as the linter, the formatter, or both. */
  biome: boolean
  /** ESLint runs: as the linter, or next to Biome for what only a plugin can check. */
  eslint: boolean
}

const hasFile = (root: string, names: readonly string[]): boolean => names.some(name => existsSync(join(root, name)))

/**
 * Work out the tools from the policy and what the repo already has.
 * Left on auto, Biome lints and formats, and ESLint runs next to it when the repo has a flat config.
 */
export const toolset = (root: string, policy: Policy): Toolset => {
  const linter: EngineName = policy.engine === 'auto' ? 'biome' : policy.engine
  // Naming Biome in the policy means Biome only. With Oxlint, ESLint still hosts the packs.
  const eslint = linter === 'eslint' || (policy.engine !== 'biome' && hasFile(root, ESLINT_CONFIG_FILES))
  const onAuto: FormatterName = linter !== 'biome' && hasFile(root, PRETTIER_CONFIG_FILES) ? 'prettier' : 'biome'
  const formatter = policy.formatter === 'auto' ? onAuto : policy.formatter

  return { linter, formatter, eslint, biome: linter === 'biome' || formatter === 'biome' }
}
