import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readJsonc, toList, toPosix } from '../fs-utils.ts'
import { guardOfMessage, importRestrictions, ruleFiles } from '../guards.ts'
import { defaultPolicy, effectiveRules } from '../policy.ts'
import { GATED_TAGS, getRule, getRuleByBiome, isGated, type RuleTag, type Technology } from '../rules.ts'
import { type Finding, type Policy, type SetupIssue } from '../types.ts'
import { EngineError, runNode } from './run.ts'

/** The Biome version this release of pawl is tested with. Kept in step with package.json by a test. */
export const BIOME_VERSION = '2.6.8'

/** What a project's biome.json extends to get the standard. */
export const BIOME_PRESET = '@santi020k/pawl/biome'

/**
 * The preset that holds one technology's rules, such as `@santi020k/pawl/biome/react`.
 * Inside pawl's own repo the standard is referred to by file, and so are these.
 */
export const biomeTechPreset = (technology: Technology, preset: string = BIOME_PRESET): string =>
  preset.endsWith('pawl.biome.json')
    ? preset.replace(/pawl\.biome\.json$/, `${technology}.biome.json`)
    : `${preset}/${technology}`

export const BIOME_REACT_PRESET = biomeTechPreset('react')

export interface BiomeContext {
  /** The technologies the project uses. Each adds its own preset. */
  technologies?: readonly Technology[]
  /** Biome lints. Off when ESLint is the linter and Biome only formats. */
  lint?: boolean
  /** Biome formats. Off when the project formats with Prettier. */
  format?: boolean
  /** Every dependency in the repo. Switches on the import guards for the libraries it uses. */
  dependencies?: readonly string[]
}

export const BIOME_CONFIG_FILES = ['biome.json', 'biome.jsonc']

const DEFAULT_IGNORES = [
  '**/dist',
  '**/build',
  '**/coverage',
  '**/.next',
  '**/.astro',
  '**/.nuxt',
  '**/.svelte-kit',
  '**/.output',
  '**/.turbo',
  '**/.pawl'
]

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

type JsonObject = { [key: string]: Json }

const BIOME_PREFIX = 'biome:'

/** Biome ignores a folder by its name alone; a trailing `/**` is flagged by Biome itself. */
const toBiomeIgnore = (pattern: string): string => `!${pattern.replace(/\/\*\*$/, '')}`

/** Keep the gated technologies in one fixed order, so generated files do not churn. */
const ordered = (technologies: readonly Technology[] = []): Technology[] =>
  GATED_TAGS.filter(technology => technologies.includes(technology))

const lintRules = (policy: Policy, include: (tag: RuleTag) => boolean): JsonObject => {
  const groups: Record<string, Record<string, Json>> = {}

  const set = (biomeRule: string, value: Json): void => {
    const [group, name] = biomeRule.split('/') as [string, string]

    groups[group] ??= {}
    groups[group][name] = value
  }

  for (const [name, level] of effectiveRules(policy)) {
    const def = getRule(name)

    if (name.startsWith(BIOME_PREFIX)) {
      set(name.slice(BIOME_PREFIX.length), level)
    } else if (def?.biome && include(def.tag)) {
      const options = level === 'off' ? undefined : (def.options?.biome as JsonObject | undefined)

      set(def.biome, options ? { level, options } : level)
    }
  }

  const rules: JsonObject = {}

  for (const group of Object.keys(groups).sort()) {
    const entries = Object.entries(groups[group] ?? {}).sort(([a], [b]) => a.localeCompare(b))

    rules[group] = Object.fromEntries(entries)
  }

  return rules
}

/**
 * The complete Biome configuration for a policy.
 * Rules for a technology are only included for projects that use it.
 */
export const biomeConfig = (
  policy: Policy,
  { technologies = [], lint = true, format = true, dependencies = [] }: BiomeContext = {}
): JsonObject => {
  const { style } = policy
  const rules = lintRules(policy, tag => !isGated(tag) || technologies.includes(tag))
  const restricted = lint ? importRestrictions(policy, dependencies) : undefined

  const plugins = lint ? ruleFiles(policy, dependencies).map(({ file }) => `./${file}`) : []

  if (restricted) {
    rules.style = {
      ...(rules.style as JsonObject | undefined),
      noRestrictedImports: { level: restricted.level, options: restricted.biome as unknown as JsonObject }
    }
  }

  return {
    $schema: `https://biomejs.dev/schemas/${BIOME_VERSION}/schema.json`,
    files: {
      includes: ['**', ...[...DEFAULT_IGNORES, ...policy.ignore].map(toBiomeIgnore)]
    },
    formatter: {
      enabled: format,
      indentStyle: style.indent === 'tab' ? 'tab' : 'space',
      indentWidth: style.indent === 'tab' ? 2 : style.indent,
      lineWidth: style.lineWidth
    },
    javascript: {
      formatter: {
        quoteStyle: style.quotes,
        jsxQuoteStyle: 'double',
        semicolons: style.semicolons ? 'always' : 'asNeeded',
        trailingCommas: style.trailingCommas,
        arrowParentheses: style.arrowParens === 'always' ? 'always' : 'asNeeded'
      }
    },
    linter: {
      enabled: lint,
      rules: { preset: 'recommended', ...rules }
    },
    assist: { actions: { source: { organizeImports: 'on' } } },
    ...(plugins.length > 0 ? { plugins } : {})
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

/**
 * Biome's own rule domain for each technology. Turning a domain on applies the rules Biome
 * recommends for it, so pawl covers a technology without listing every rule itself.
 */
export const BIOME_DOMAINS: Record<Technology, string> = {
  react: 'react',
  next: 'next',
  'react-native': 'reactNative',
  qwik: 'qwik',
  solid: 'solid',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  tailwind: 'tailwind',
  'tanstack-query': 'tanstackQuery',
  drizzle: 'drizzle',
  playwright: 'playwright',
  turbo: 'turborepo'
}

/**
 * One technology's part of the standard on its own, shipped as a separate preset:
 * Biome's recommended rules for it, then the levels the pawl catalog sets.
 */
export const biomeTechConfig = (policy: Policy, technology: Technology): JsonObject => {
  const rules = lintRules({ ...policy, rules: {} }, tag => tag === technology)

  return {
    linter: {
      domains: { [BIOME_DOMAINS[technology]]: 'recommended' },
      ...(Object.keys(rules).length > 0 ? { rules } : {})
    }
  }
}

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A rule set with options is one value: Biome does not merge half of it from a preset. */
const isRuleValue = (value: Json | undefined): boolean => isObject(value) && 'level' in value

/** The parts of `value` that differ from `base`. Arrays and rule values are compared whole. */
const diff = (value: JsonObject, base: JsonObject): JsonObject => {
  const out: JsonObject = {}

  for (const [key, entry] of Object.entries(value)) {
    const other = base[key]

    if (isObject(entry) && isObject(other) && !isRuleValue(entry) && !isRuleValue(other)) {
      const nested = diff(entry, other)

      if (Object.keys(nested).length > 0) out[key] = nested
    } else if (JSON.stringify(entry) !== JSON.stringify(other)) {
      out[key] = entry
    }
  }

  return out
}

/** True when everything in `expected` is present in `actual` with the same value. */
const contains = (actual: Json | undefined, expected: Json): boolean => {
  if (isObject(expected) && !isRuleValue(expected)) {
    return isObject(actual) && Object.entries(expected).every(([key, entry]) => contains(actual[key], entry))
  }

  return JSON.stringify(actual) === JSON.stringify(expected)
}

/** Matches the published preset and, inside pawl's own repo, the preset file itself. */
const PRESET_REFERENCE = /(?:^|\/)pawl\/biome$|(?:^|\/)pawl\.biome\.json$/

/**
 * The biome.json a project should have: the presets, plus only what its policy changes.
 * Biome merges `files.includes` with the preset's list, so the project file only adds to it.
 * A project on the default standard gets a file with a single `extends` line.
 */
export const biomeProjectConfig = (
  policy: Policy,
  context: BiomeContext = {},
  preset: string = BIOME_PRESET
): JsonObject => {
  const { files: _files, ...delta } = diff(
    biomeConfig(policy, context),
    biomeConfig(defaultPolicy(), { technologies: context.technologies ?? [] })
  )

  return {
    extends: [preset, ...ordered(context.technologies).map(technology => biomeTechPreset(technology, preset))],
    // Biome adds these to the preset's list, so only the project's own patterns go here.
    ...(policy.ignore.length > 0 ? { files: { includes: policy.ignore.map(toBiomeIgnore) } } : {}),
    ...delta
  }
}

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

/** Compare the project's biome.json with what the policy calls for. */
export const checkBiomeConfig = (root: string, policy: Policy, context: BiomeContext = {}): BiomeConfigCheck => {
  const file = BIOME_CONFIG_FILES.find(name => existsSync(join(root, name)))

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
  const present = extendsList(value)
  const extendsOk = (expectedExtends as Json[]).every(entry => present.includes(entry))

  if (!extendsOk || !contains(value, expected)) {
    return {
      status: 'stale',
      file,
      preset,
      issue: { code: 'biome-config-stale', message: `${file} is out of date with the policy.`, fix: 'Run "pawl sync".' }
    }
  }

  return { status: 'ok', file, preset }
}

/**
 * The biome.json of one package in a monorepo that uses a technology the rest of the repo does not.
 * It builds on the root config and adds that technology's rules for this package only.
 */
export const biomePackageConfig = (
  packageDir: string,
  technologies: readonly Technology[],
  rootFile = 'biome.json',
  preset: string = BIOME_PRESET
): JsonObject => {
  const up = '../'.repeat(packageDir.split('/').length)
  // A preset referred to by file, as inside pawl's own repo, is reached from the package's folder.
  const reference = preset.startsWith('.') ? `${up}${preset.replace(/^\.\//, '')}` : preset

  return {
    root: false,
    extends: [`${up}${rootFile}`, ...ordered(technologies).map(technology => biomeTechPreset(technology, reference))]
  }
}

export interface BiomePackageCheck {
  dir: string
  file: string
  status: 'ok' | 'missing' | 'stale' | 'unreadable'
  expected: JsonObject
  /** The file's current content, when it could be read without losing comments. */
  current?: JsonObject
}

/** Compare each package's biome.json with the technologies that package uses. */
export const checkBiomePackages = (
  root: string,
  perPackage: Readonly<Record<string, readonly Technology[]>>,
  rootFile = 'biome.json',
  preset: string = BIOME_PRESET
): BiomePackageCheck[] =>
  Object.entries(perPackage).map(([dir, technologies]) => {
    const expected = biomePackageConfig(dir, technologies, rootFile, preset)
    const name = BIOME_CONFIG_FILES.find(candidate => existsSync(join(root, dir, candidate)))
    const file = `${dir}/${name ?? 'biome.json'}`

    if (!name) return { dir, file, status: 'missing', expected }

    const { value, hasComments } = readJsonc<JsonObject>(join(root, file))

    if (!value) return { dir, file, status: 'unreadable', expected }

    const present = extendsList(value)
    const ok = (expected.extends as Json[]).every(entry => present.includes(entry))

    return { dir, file, status: ok ? 'ok' : 'stale', expected, ...(hasComments ? {} : { current: value }) }
  })

const resolveBin = (root: string): string => {
  for (const from of [join(root, 'package.json'), import.meta.filename]) {
    try {
      return createRequire(from).resolve('@biomejs/biome/bin/biome')
    } catch {
      // Try the next place.
    }
  }

  throw new EngineError(
    `Biome is not installed in this project. Add @biomejs/biome@${BIOME_VERSION} with your package manager.`,
    {
      command: 'biome'
    }
  )
}

/** Biome is installed in the project, or beside pawl itself. */
export const biomeInstalled = (root: string): boolean => {
  try {
    resolveBin(root)

    return true
  } catch {
    return false
  }
}

interface BiomeDiagnostic {
  severity: string
  message: string
  category: string
  location?: { path?: string; start?: { line: number; column: number } }
}

interface BiomeReport {
  diagnostics: BiomeDiagnostic[]
}

const toFinding = (diagnostic: BiomeDiagnostic): Finding | undefined => {
  if (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') return undefined

  const file = toPosix(diagnostic.location?.path ?? '')
  const line = Math.max(1, diagnostic.location?.start?.line ?? 1)
  const column = Math.max(1, diagnostic.location?.start?.column ?? 1)
  const severity = diagnostic.severity === 'error' ? 'error' : 'warn'
  const base = { file, line, column, engine: 'biome' as const, severity, message: diagnostic.message.trim() } as const
  const { category } = diagnostic

  if (category === 'format') {
    return { ...base, engineRule: 'format', rule: 'pawl/format', message: 'File is not formatted.', fixable: true }
  }

  if (category.startsWith('assist/')) {
    return {
      ...base,
      engineRule: category,
      rule: 'pawl/organize-imports',
      message: 'Imports are not sorted.',
      fixable: true
    }
  }

  if (category.startsWith('lint/')) {
    const engineRule = category.slice('lint/'.length)

    return {
      ...base,
      engineRule,
      rule: getRuleByBiome(engineRule)?.name ?? `${BIOME_PREFIX}${engineRule}`,
      fixable: false
    }
  }

  // One of pawl's own rules, which Biome runs as a plugin and reports under one shared name.
  const guard = category === 'plugin' ? guardOfMessage(base.message) : undefined

  if (guard) return { ...base, engineRule: `pawl/${guard}`, rule: `pawl/${guard}`, fixable: false }

  return { ...base, engineRule: category, rule: `${BIOME_PREFIX}${category}`, fixable: false }
}

export interface EngineRun {
  findings: Finding[]
  command: string
}

export interface RunOptions {
  root: string
  /** Files to check, relative to the root. Omit to check the whole project. */
  files?: readonly string[]
  /** Apply safe fixes and formatting. */
  write?: boolean
}

/** Run Biome and turn its report into findings. */
export const runBiome = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const args = ['check', '--reporter=json', '--max-diagnostics=none', '--no-errors-on-unmatched', '--colors=off']

  if (write) args.push('--write')

  args.push(...(files && files.length > 0 ? files : ['.']))

  const result = await runNode(resolveBin(root), args, root, 'biome')
  const start = result.stdout.indexOf('{')

  if (start === -1) {
    throw new EngineError(result.stderr.trim() || `Biome exited with code ${result.code} and no report.`, {
      command: result.command
    })
  }

  let report: BiomeReport

  try {
    report = JSON.parse(result.stdout.slice(start)) as BiomeReport
  } catch (cause) {
    throw new EngineError(`Could not read Biome's report.\n${result.stderr.trim()}`, { command: result.command, cause })
  }

  const findings = report.diagnostics.map(toFinding).filter((finding): finding is Finding => finding !== undefined)

  return {
    findings,
    command: result.command.replace(' --reporter=json --max-diagnostics=none --no-errors-on-unmatched --colors=off', '')
  }
}
