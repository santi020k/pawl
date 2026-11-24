/** A project's Biome config files on disk, against what the policy calls for. */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ruleFiles } from '../../catalog/guards.ts'
import { extraGlobals, RUNTIMES } from '../../catalog/runtimes.ts'
import { BIOME_CONFIG_FILES, firstExisting } from '../../project/config-files.ts'
import { type Detection, packageTechnologies, technologies as repoTechnologies } from '../../project/detect.ts'
import { listFiles } from '../../project/files.ts'
import { ALWAYS_IGNORED } from '../../project/ignores.ts'
import { type Policy, type SetupIssue } from '../../types.ts'
import { ancestors } from '../../utils/fs.ts'
import { isRecord, type Json, type JsonObject, type JsonRecord, readJsonc, sameJson } from '../../utils/json.ts'
import { toList } from '../../utils/list.ts'
import { PACKAGE_NAME } from '../../version.ts'
import { BIOME_PRESET, type BiomeContext, biomeProjectConfig, isRuleValue } from './config.ts'

/** Biome reads the .gitignore when the policy wants it and there is a .gitignore or a git repo to read. */
export const biomeVcs = (root: string, policy: Pick<Policy, 'gitignore'>): boolean =>
  policy.gitignore && (existsSync(join(root, '.gitignore')) || existsSync(join(root, '.git')))

/** The Biome context for a project as it stands on disk. */
export const biomeContextFor = (
  root: string,
  policy: Policy,
  detection: Detection,
  tools: { linter: string; formatter: string }
): BiomeContext => {
  const packages = packageTechnologies(detection)

  return {
    technologies: repoTechnologies(detection),
    packages: Object.fromEntries(detection.workspace.packages.map(dir => [dir, packages[dir] ?? []])),
    dependencies: detection.dependencies,
    lint: tools.linter === 'biome',
    format: tools.formatter === 'biome',
    vcs: biomeVcs(root, policy),
    runtimes: detection.runtimes,
    ignores: detection.ignores
  }
}

export interface RuleFileState {
  /** Relative to the project root. */
  file: string
  content: string
  status: 'ok' | 'missing' | 'stale'
}

/**
 * The files of pawl's own Biome rules, and whether each is in place.
 * A package with a Biome config of its own needs a copy: Biome looks for an inherited plugin
 * next to the config that inherits it, not next to the one that names it.
 */
export const checkRuleFiles = (
  root: string,
  policy: Policy,
  context: BiomeContext = {},
  packageDirs: readonly string[] = []
): RuleFileState[] => {
  const files = context.lint === false ? [] : ruleFiles(policy, context.dependencies)

  return ['', ...packageDirs].flatMap(dir =>
    files.map(({ file, content }) => {
      const relative = dir ? `${dir}/${file}` : file
      const path = join(root, relative)
      const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
      const stale = current === content ? 'ok' : 'stale'

      return { file: relative, content, status: current === undefined ? 'missing' : stale }
    })
  )
}

/** True when everything in `expected` is present in `actual` with the same value. */
const contains = (actual: Json | undefined, expected: Json): boolean => {
  if (isRecord(expected) && !isRuleValue(expected)) {
    return isRecord(actual) && Object.entries(expected).every(([key, entry]) => contains(actual[key], entry))
  }

  return sameJson(actual, expected)
}

/** Inline arrays do not identify which entries Pawl owns; do not guess their precedence. */
export const inlineOverridesConflict = (actual: JsonRecord, expected: JsonRecord): boolean =>
  Array.isArray(actual.overrides) &&
  actual.overrides.length > 0 &&
  expected.overrides !== undefined &&
  !sameJson(actual.overrides, expected.overrides)

/** The global names pawl writes for a runtime. Any other name in `javascript.globals` is the project's own. */
const PAWL_GLOBALS = new Set(extraGlobals(RUNTIMES))

const globalsOf = (config: JsonRecord): string[] => {
  const list = isRecord(config.javascript) ? config.javascript.globals : undefined

  return Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : []
}

/** The runtime globals pawl wrote, sorted. */
const ownedGlobals = (config: JsonRecord): string[] =>
  globalsOf(config)
    .filter(name => PAWL_GLOBALS.has(name))
    .sort()

const withoutGlobals = (config: JsonObject): JsonObject => {
  if (!isRecord(config.javascript)) return config

  const { globals: _globals, ...javascript } = config.javascript

  return { ...config, javascript }
}

/**
 * Put the runtime globals of `expected` into a biome.json, keeping the names the project added
 * itself. A runtime the project no longer uses takes its names with it.
 */
export const syncBiomeGlobals = (config: JsonRecord, expected: JsonRecord): JsonRecord => {
  const globals = [...globalsOf(config).filter(name => !PAWL_GLOBALS.has(name)), ...globalsOf(expected)]
  const javascript = isRecord(config.javascript) ? config.javascript : {}
  const { globals: _globals, ...rest } = javascript
  const next = globals.length > 0 ? { ...rest, globals } : rest

  if (Object.keys(next).length > 0) return { ...config, javascript: next }

  const { javascript: _javascript, ...withoutJavascript } = config

  return withoutJavascript
}

/** Matches the published preset and, inside pawl's own repo, the preset file itself. */
const PRESET_REFERENCE = /(?:^|\/)pawl\/biome$|(?:^|\/)pawl\.biome\.json$/

export type BiomeConfigStatus = 'ok' | 'missing' | 'stale' | 'foreign'

export interface BiomeConfigCheck {
  status: BiomeConfigStatus
  file: string | undefined
  /** How the file refers to the standard, when it does. */
  preset?: string
  issue?: SetupIssue
}

const extendsList = (config: JsonObject): Json[] => toList<Json>(config.extends)

const findPreset = (config: JsonObject): string | undefined =>
  extendsList(config).find((entry): entry is string => typeof entry === 'string' && PRESET_REFERENCE.test(entry))

/**
 * True when the project can load pawl by name, as a biome.json that extends `@santi020k/pawl/biome`
 * needs. It cannot when pawl only ran through npx, or before the first install after a clone.
 */
export const presetInstalled = (root: string): boolean =>
  // Biome looks in the node_modules folders above the config and nowhere else, so the same is done here.
  ancestors(root).some(dir => existsSync(join(dir, 'node_modules', PACKAGE_NAME, 'package.json')))

/** A biome.json that names the standard by package, not by file as pawl's own repo does. */
export const extendsPackage = (preset: string | undefined): boolean => preset?.startsWith(PACKAGE_NAME) === true

/** Compare the project's biome.json with what the policy calls for. */
export const checkBiomeConfig = (root: string, policy: Policy, context: BiomeContext = {}): BiomeConfigCheck => {
  const file = firstExisting(root, BIOME_CONFIG_FILES)

  if (!file) {
    return {
      status: 'missing',
      file,
      issue: { code: 'biome-config-missing', message: 'No biome.json found.', fix: 'Run "pawl init" or "pawl sync".' }
    }
  }

  const { value } = readJsonc<JsonObject>(join(root, file))
  const preset = value ? findPreset(value) : undefined

  if (!value || !preset) {
    return {
      status: 'foreign',
      file,
      issue: {
        code: 'biome-config-foreign',
        message: `${file} does not extend the pawl standard, so Biome is running with its own settings.`,
        fix: `Add "${BIOME_PRESET}" to "extends" in ${file}, or run "pawl sync".`
      }
    }
  }

  const { extends: expectedExtends, ...expected } = biomeProjectConfig(policy, context, preset)
  if (inlineOverridesConflict(value, expected)) {
    return {
      status: 'stale',
      file,
      preset,
      issue: {
        code: 'biome-overrides-conflict',
        message: `${file} has inline overrides whose ownership cannot be established.`,
        fix: 'Preserve a backup and reconcile inline overrides with the root policy before syncing; Pawl leaves the file unchanged.'
      }
    }
  }

  const present = extendsList(value)
  const extendsOk = (expectedExtends as Json[]).every(entry => present.includes(entry))
  const globalsOk = sameJson(ownedGlobals(value), ownedGlobals(expected))

  if (!extendsOk || !globalsOk || !contains(withoutGlobals(value), withoutGlobals(expected))) {
    return {
      status: 'stale',
      file,
      preset,
      issue: { code: 'biome-config-stale', message: `${file} is out of date with the policy.`, fix: 'Run "pawl sync".' }
    }
  }

  return { status: 'ok', file, preset }
}

/** Config files govern source paths even when Git ignores the config itself. */
export const nestedBiomeConfigs = (root: string, useGitFiles = true): string[] => {
  const directories = new Set<string>()
  const addParents = (file: string): void => {
    let dir = dirname(file)

    while (dir !== '.') {
      directories.add(dir)
      dir = dirname(dir)
    }
  }
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory() || ALWAYS_IGNORED.includes(entry.name)) continue

      const child = dir ? `${dir}/${entry.name}` : entry.name

      directories.add(child)
      walk(child)
    }
  }

  if (useGitFiles) listFiles(root).forEach(addParents)
  else walk('')

  return [...directories]
    .flatMap(dir => BIOME_CONFIG_FILES.filter(name => existsSync(join(root, dir, name))).map(name => `${dir}/${name}`))
    .sort()
}
