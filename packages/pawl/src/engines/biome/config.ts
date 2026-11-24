import { importRestrictions, ruleFiles } from '../../catalog/guards.ts'
import { GATED_TAGS, getRule, isGated, type RuleTag, scopedRule, type Technology } from '../../catalog/rules.ts'
import { extraGlobals } from '../../catalog/runtimes.ts'
import { effectiveRules, overrideRules } from '../../policy/levels.ts'
import { defaultPolicy } from '../../policy/merge.ts'
import { configIgnores, DEFAULT_IGNORES, toBiomeIgnore, toEngineGlob } from '../../project/ignores.ts'
import { type Level, type Policy, type Runtime } from '../../types.ts'
import { isRecord, type Json, type JsonObject, sameJson, sortKeys } from '../../utils/json.ts'
import { nestedPackageExclusions, packagePatterns } from './scopes.ts'

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

export interface BiomeContext {
  /** The technologies the project uses. Each adds its own preset. */
  technologies?: readonly Technology[]
  /** Technologies owned by individual workspace packages, scoped from the project root. */
  packages?: Readonly<Record<string, readonly Technology[]>>
  /** Biome lints. Off when ESLint is the linter and Biome only formats. */
  lint?: boolean
  /** Biome formats. Off when the project formats with Prettier. */
  format?: boolean
  /** Every dependency in the repo. Switches on the import guards for the libraries it uses. */
  dependencies?: readonly string[]
  /** Let Biome read the .gitignore. Only where there is one, or a git repo: Biome fails without either. */
  vcs?: boolean
  /** Where the code runs. Biome knows the Node and browser globals; the others are named for it. */
  runtimes?: readonly Runtime[]
  /** Patterns to skip that detection found, such as the target folder of a Rust project. */
  ignores?: readonly string[]
}

/**
 * Biome's git settings. Turning `gitignore` off says so, so that a biome.json pawl wrote before
 * stops reading the .gitignore once it is synced.
 */
const vcsConfig = (policy: Policy, vcs: boolean): JsonObject => {
  if (vcs) return { vcs: { enabled: true, clientKind: 'git', useIgnoreFile: true } }

  return policy.gitignore ? {} : { vcs: { useIgnoreFile: false } }
}

/** Keep the gated technologies in one fixed order, so generated files do not churn. */
const ordered = (technologies: readonly Technology[] = []): Technology[] =>
  GATED_TAGS.filter(technology => technologies.includes(technology))

/** Rules as Biome groups them: `{ group: { rule: value } }`, sorted so generated files do not churn. */
const toGroups = (entries: readonly [string, Json][]): JsonObject => {
  const groups: Record<string, Record<string, Json>> = {}

  for (const [biomeRule, value] of entries) {
    const [group, name] = biomeRule.split('/') as [string, string]

    groups[group] ??= {}
    groups[group][name] = value
  }

  const rules: JsonObject = {}

  for (const group of Object.keys(groups).sort()) {
    rules[group] = sortKeys(groups[group] ?? {})
  }

  return rules
}

/** The options the policy gives a rule for Biome, by the rule's neutral name. */
type OptionsFor = (name: string) => Record<string, unknown> | undefined

/** One rule as Biome takes it, or undefined when Biome has no such rule or it is for another technology. */
const biomeEntry = (
  name: string,
  level: Level,
  include: (tag: RuleTag) => boolean,
  optionsFor: OptionsFor
): [string, Json] | undefined => {
  const scoped = scopedRule(name, 'biome')
  const def = scoped === undefined ? getRule(name) : undefined
  const biomeRule = scoped ?? def?.biome

  if (!biomeRule || (def && !include(def.tag))) return undefined

  // The policy's options replace the standard's, as they do for ESLint.
  const options = level === 'off' ? undefined : ((optionsFor(name) ?? def?.options?.biome) as JsonObject | undefined)

  return [biomeRule, options ? { level, options } : level]
}

/** The Biome entries of a list of rule levels, leaving out what Biome does not have. */
const biomeEntries = (
  levels: Iterable<[string, Level]>,
  include: (tag: RuleTag) => boolean,
  optionsFor: OptionsFor
): [string, Json][] =>
  [...levels].flatMap(([name, level]) => {
    const entry = biomeEntry(name, level, include, optionsFor)

    return entry ? [entry] : []
  })

const lintRules = (policy: Policy, include: (tag: RuleTag) => boolean): JsonObject =>
  toGroups(biomeEntries(effectiveRules(policy), include, name => policy.biomeOptions[name]))

/** The policy's overrides as Biome's: one per override that sets a rule Biome has, or gives one options. */
const biomeOverrides = (
  policy: Policy,
  include: (tag: RuleTag) => boolean,
  packages: NonNullable<BiomeContext['packages']> = {}
): JsonObject[] =>
  policy.overrides.flatMap(override => {
    const entries = (accept: (tag: RuleTag) => boolean): [string, Json][] =>
      biomeEntries(
        overrideRules(override, undefined, policy, override.biomeOptions),
        accept,
        name => override.biomeOptions[name] ?? policy.biomeOptions[name]
      )
    const shared = entries(include)
    const scoped = Object.entries(packages).flatMap(([dir, technologies]) => {
      const own = entries(tag => !include(tag) && isGated(tag) && technologies.includes(tag))
      const includes = packagePatterns(override.files, dir)

      if (own.length === 0 || !includes.some(pattern => !pattern.startsWith('!'))) return []

      return [
        {
          includes: [...includes, ...nestedPackageExclusions(dir, Object.keys(packages))],
          linter: { rules: toGroups(own) }
        }
      ]
    })

    return [
      ...(shared.length > 0
        ? [{ includes: override.files.map(toEngineGlob), linter: { rules: toGroups(shared) } }]
        : []),
      ...scoped
    ]
  })

/** Package domains and rules stay in the root config so policy globs keep their original base. */
const packageOverrides = (policy: Policy, packages: NonNullable<BiomeContext['packages']>, lint = true): JsonObject[] =>
  Object.entries(packages).flatMap(([dir, technologies]) =>
    ordered(technologies).flatMap(technology => {
      const { linter: _linter, ...parser } = biomeTechConfig(policy, technology)

      if (!lint && Object.keys(parser).length === 0) return []

      return [
        {
          ...parser,
          includes: [`${dir}/**`, ...nestedPackageExclusions(dir, Object.keys(packages))],
          ...(lint
            ? {
                linter: {
                  domains: { [BIOME_DOMAINS[technology]]: 'recommended' },
                  rules: lintRules(policy, tag => tag === technology)
                }
              }
            : {})
        }
      ]
    })
  )

/** Component files: a script Biome reads, and a template it does not unless its HTML support is switched on. */
export const TEMPLATE_FILES = ['**/*.vue', '**/*.svelte', '**/*.astro']

/**
 * Rules that judge a name by how the script uses it. In a component file the template uses names
 * too, and Biome does not read it, so these would report what the template needs as unused, and
 * the fix for a type-only import would turn one the template uses as a value into `import type`.
 * Biome's own guide switches the same four off for these files.
 */
export const TEMPLATE_BLIND_RULES = [
  'no-unused-vars',
  'unused-imports/no-unused-imports',
  'prefer-const',
  '@typescript-eslint/consistent-type-imports'
]

/**
 * The overrides the standard itself brings, ahead of the policy's own so that a policy can undo
 * them, for example once it has switched on Biome's full support for these files.
 */
const standardOverrides = (include: (tag: RuleTag) => boolean): JsonObject[] => {
  const entries = biomeEntries(
    TEMPLATE_BLIND_RULES.map((name): [string, Level] => [name, 'off']),
    include,
    () => undefined
  )

  return [{ includes: TEMPLATE_FILES, linter: { rules: toGroups(entries) } }]
}

/**
 * The complete Biome configuration for a policy.
 * Rules for a technology are only included for projects that use it.
 */
export const biomeConfig = (
  policy: Policy,
  {
    technologies = [],
    packages = {},
    lint = true,
    format = true,
    dependencies = [],
    vcs = false,
    runtimes = [],
    ignores = []
  }: BiomeContext = {}
): JsonObject => {
  const { style } = policy
  const include = (tag: RuleTag): boolean => !isGated(tag) || technologies.includes(tag)
  const rules = lintRules(policy, include)
  const overrides = [
    ...(lint ? standardOverrides(include) : []),
    ...packageOverrides(policy, packages, lint),
    ...(lint ? biomeOverrides(policy, include, packages) : [])
  ]
  const globals = extraGlobals(runtimes)
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
    ...vcsConfig(policy, vcs),
    files: {
      includes: ['**', ...configIgnores(policy, ignores).map(toBiomeIgnore)]
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
      },
      ...(globals.length > 0 ? { globals } : {})
    },
    linter: {
      enabled: lint,
      rules: { preset: 'recommended', ...rules }
    },
    // package.json in the order the ecosystem expects. tsconfig has no such order, so it is left alone.
    assist: { actions: { source: { organizeImports: 'on', useSortedPackageJson: 'on' } } },
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(overrides.length > 0 ? { overrides } : {})
  }
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
  const rules = lintRules({ ...policy, rules: {}, biomeOptions: {} }, tag => tag === technology)

  return {
    // Tailwind's own at-rules, such as @apply and @theme, are errors to Biome's CSS parser otherwise.
    ...(technology === 'tailwind' ? { css: { parser: { tailwindDirectives: true } } } : {}),
    linter: {
      domains: { [BIOME_DOMAINS[technology]]: 'recommended' },
      ...(Object.keys(rules).length > 0 ? { rules } : {})
    }
  }
}

/** A rule set with options is one value: Biome does not merge half of it from a preset. */
export const isRuleValue = (value: Json | undefined): boolean => isRecord(value) && 'level' in value

/** The parts of `value` that differ from `base`. Arrays and rule values are compared whole. */
const diff = (value: JsonObject, base: JsonObject): JsonObject => {
  const out: JsonObject = {}

  for (const [key, entry] of Object.entries(value)) {
    const other = base[key]

    if (isRecord(entry) && isRecord(other) && !isRuleValue(entry) && !isRuleValue(other)) {
      const nested = diff(entry, other)

      if (Object.keys(nested).length > 0) out[key] = nested
    } else if (!sameJson(entry, other)) {
      out[key] = entry
    }
  }

  return out
}

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
  const {
    files: _files,
    overrides: _overrides,
    ...delta
  } = diff(biomeConfig(policy, context), biomeConfig(defaultPolicy(), { technologies: context.technologies ?? [] }))
  const include = (tag: RuleTag): boolean => !isGated(tag) || (context.technologies ?? []).includes(tag)
  // Biome adds a project's overrides after the preset's, so the standard's own are not repeated here.
  const overrides = [
    ...packageOverrides(policy, context.packages ?? {}, context.lint !== false),
    ...(context.lint === false ? [] : biomeOverrides(policy, include, context.packages))
  ]
  // A later pattern wins in Biome, so the preset's ignores are undone by naming the folders again.
  // The build folders detection found, such as a Rust project's target, are the project's own.
  const includes = [
    ...(policy.defaultIgnores
      ? (context.ignores ?? []).map(toBiomeIgnore)
      : DEFAULT_IGNORES.map(pattern => toBiomeIgnore(`!${pattern}`))),
    ...policy.ignore.map(toBiomeIgnore)
  ]

  return {
    extends: [preset, ...ordered(context.technologies).map(technology => biomeTechPreset(technology, preset))],
    // Biome adds these to the preset's list, so only the project's own patterns go here.
    ...(includes.length > 0 ? { files: { includes } } : {}),
    ...delta,
    ...(overrides.length > 0 ? { overrides } : {})
  }
}

/**
 * The biome.json of one package in a monorepo that uses a technology the rest of the repo does not.
 * Legacy config shape, retained for callers inspecting old generated configs. Use biomeProjectConfig
 * with package scopes for new configs; nested inheritance
 * changes the base of policy globs in Biome 2.6.8 and is rejected by check and fix.
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
