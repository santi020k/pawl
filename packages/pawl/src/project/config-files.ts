/**
 * The config file names of every tool pawl drives or looks for. Each list is in the order the
 * tool itself searches, so the first file that exists is the one the tool reads.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** A pawl policy. */
export const PAWL_CONFIG_FILES = [
  'pawl.config.ts',
  'pawl.config.mts',
  'pawl.config.js',
  'pawl.config.mjs',
  'pawl.config.json'
]

export const BIOME_CONFIG_FILES = ['biome.json', 'biome.jsonc']

/** ESLint's flat config, the only kind pawl writes and builds on. */
export const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts'
]

/** ESLint's legacy config. `pawl migrate` reads it; nothing else does. */
export const ESLINT_LEGACY_CONFIG_FILES = [
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.json',
  '.eslintrc'
]

/** The Oxlint config pawl writes and keeps in line with the policy. */
export const OXLINT_CONFIG_FILE = '.oxlintrc.json'

export const OXLINT_CONFIG_FILES = ['oxlint.config.ts', 'oxlint.config.mts', OXLINT_CONFIG_FILE]

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

export const CSPELL_CONFIG_FILES = [
  'cspell.json',
  '.cspell.json',
  'cSpell.json',
  'cspell.jsonc',
  '.cspell.jsonc',
  'cspell.config.json',
  'cspell.config.yaml',
  'cspell.config.yml',
  'cspell.config.js',
  'cspell.config.cjs',
  'cspell.config.mjs'
]

export const JSDOC_CONFIG_FILES = [
  'jsdoc.json',
  '.jsdoc.json',
  'jsdoc.config.js',
  'jsdoc.config.cjs',
  'jsdoc.config.mjs'
]

export const TSCONFIG_FILES = ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json', 'tsconfig.node.json']

export const LEFTHOOK_CONFIG_FILES = ['lefthook.yml', '.lefthook.yml', 'lefthook.yaml']

/** The first of `names` that exists in `dir`, relative to it. */
export const firstExisting = (dir: string, names: readonly string[]): string | undefined =>
  names.find(name => existsSync(join(dir, name)))

/** True when any of `names` exists in `dir`. */
export const hasAny = (dir: string, names: readonly string[]): boolean => firstExisting(dir, names) !== undefined
