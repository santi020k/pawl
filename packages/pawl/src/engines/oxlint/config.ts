import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IMPORTS_RULE, importRestrictions } from '../../catalog/guards.ts'
import { getRule, scopedRule, type Technology } from '../../catalog/rules.ts'
import { extraGlobals, oxlintEnv } from '../../catalog/runtimes.ts'
import { effectiveRules, overrideRules, type RuleContext } from '../../policy/levels.ts'
import { OXLINT_CONFIG_FILE } from '../../project/config-files.ts'
import { allTechnologies, type Detection } from '../../project/detect.ts'
import { ALWAYS_IGNORED, configIgnores, toEngineGlob } from '../../project/ignores.ts'
import { type Level, type Policy, type Runtime, type SetupIssue } from '../../types.ts'
import { ancestors } from '../../utils/fs.ts'
import { isRecord, readJson, readJsonc, sameJson, sortKeys } from '../../utils/json.ts'
import { OXLINT_RULES, OXLINT_TYPE_AWARE_RULES } from './rules.ts'

/** Oxlint's own name back to the neutral one, for reading its report. */
const NEUTRAL = new Map(
  [...Object.entries(OXLINT_RULES), ...Object.entries(OXLINT_TYPE_AWARE_RULES)].map(([name, rule]) => [rule, name])
)

/** The rule of the standard an Oxlint rule enforces, such as `no-floating-promises` for `typescript/no-floating-promises`. */
export const oxlintCatalogName = (engineRule: string): string | undefined => NEUTRAL.get(engineRule)

/**
 * True when Oxlint enforces this rule of the standard. A rule that needs type information counts
 * only when `typeAware` says oxlint-tsgolint is there to run it.
 */
export const oxlintCovers = (name: string, typeAware = false): boolean =>
  OXLINT_RULES[name] !== undefined || (typeAware && OXLINT_TYPE_AWARE_RULES[name] !== undefined)

/** What a rule Oxlint has no equivalent for waits on: nothing a person can install. */
export const NO_OXLINT_EQUIVALENT = 'no Oxlint equivalent'

/** The package that gives Oxlint the rules that need type information. */
export const TYPE_AWARE_PACKAGE = 'oxlint-tsgolint'

/**
 * The rules of the standard that are on and that Oxlint does not enforce, each with what would
 * close the gap: the package that brings the rule, or that Oxlint has no equivalent. Pawl's own
 * rules and the other engines' rules are not Oxlint's to enforce, so they are left out.
 */
export const oxlintGaps = (policy: Policy, context?: OxlintContext): Array<{ rule: string; needs: string }> =>
  [...effectiveRules(policy, context)]
    .filter(
      ([name, level]) =>
        level !== 'off' &&
        !name.startsWith('pawl/') &&
        !name.startsWith('biome:') &&
        !name.startsWith('oxlint:') &&
        !oxlintCovers(name, context?.typeAware)
    )
    .map(([rule]) => ({ rule, needs: OXLINT_TYPE_AWARE_RULES[rule] ? TYPE_AWARE_PACKAGE : NO_OXLINT_EQUIVALENT }))
    .sort((a, b) => a.rule.localeCompare(b.rule))

export interface OxlintContext extends RuleContext {
  /** Where the code runs, for the globals Oxlint knows. Node and the browser when not given. */
  runtimes?: readonly Runtime[]
  /**
   * The project has oxlint-tsgolint, so the rules that need type information are written and switched
   * on. Declared counts as having it, as for every other tool: the config follows package.json, not
   * whether the install has run yet, and a check says so when it has not.
   */
  typeAware?: boolean
}

/**
 * True when the root package.json has oxlint-tsgolint in its dependencies or devDependencies. Oxlint
 * runs at the root and looks for tsgolint from there, so a workspace package's copy, or a peer that
 * nothing installs, does not count.
 */
export const rootDeclaresTsgolint = (root: string): boolean => {
  const manifest = readJson<{ dependencies?: object; devDependencies?: object }>(join(root, 'package.json'))

  return TYPE_AWARE_PACKAGE in { ...manifest?.dependencies, ...manifest?.devDependencies }
}

/**
 * The Oxlint context for a project. One Oxlint config covers the whole repo, so it takes every
 * technology in it. `adding` is what `pawl init` is about to add to the root package.json.
 */
export const oxlintContextFor = (
  detection: Detection,
  root?: string,
  adding: readonly string[] = []
): OxlintContext => ({
  typescript: true,
  technologies: allTechnologies(detection),
  dependencies: detection.dependencies,
  runtimes: detection.runtimes,
  typeAware:
    adding.includes(TYPE_AWARE_PACKAGE) ||
    (root === undefined
      ? detection.dependencies.includes(TYPE_AWARE_PACKAGE)
      : rootDeclaresTsgolint(root) || tsgolintInstalled(root))
})

/** Oxlint's name for a rule of the standard, or undefined when Oxlint does not have it. */
const oxlintRule = (name: string, typeAware = false): string | undefined =>
  scopedRule(name, 'oxlint') ?? OXLINT_RULES[name] ?? (typeAware ? OXLINT_TYPE_AWARE_RULES[name] : undefined)

/**
 * Names a framework's compiler hands a component file, which no import declares. Oxlint reads the
 * script alone, so without these it reports each of them as undefined.
 */
const COMPONENT_GLOBALS: Partial<Record<Technology, { files: string[]; globals: string[] }>> = {
  vue: {
    files: ['**/*.vue'],
    globals: [
      'defineEmits',
      'defineExpose',
      'defineModel',
      'defineOptions',
      'defineProps',
      'defineSlots',
      'withDefaults'
    ]
  },
  svelte: {
    files: ['**/*.svelte', '**/*.svelte.js', '**/*.svelte.ts'],
    globals: ['$bindable', '$derived', '$effect', '$host', '$inspect', '$props', '$state']
  },
  astro: { files: ['**/*.astro'], globals: ['Astro', 'Fragment'] }
}

/** The TypeScript files, which the rules that need type information are for. */
const TYPESCRIPT_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']

/** The overrides the standard itself brings, ahead of the policy's own: the globals of the component files in use. */
const standardOverrides = (technologies: readonly Technology[] = []): Record<string, unknown>[] =>
  technologies.flatMap(technology => {
    const component = COMPONENT_GLOBALS[technology]

    return component
      ? [{ files: component.files, globals: Object.fromEntries(component.globals.map(name => [name, 'readonly'])) }]
      : []
  })

/**
 * The Oxlint configuration for a policy. Oxlint refuses a rule it does not know, so only the
 * rules in `OXLINT_RULES` are written; the rest are left to ESLint or reported by `pawl doctor`.
 * Oxlint reads the .gitignore itself, so it is not repeated here.
 */
export const oxlintConfig = (policy: Policy, context?: OxlintContext): Record<string, unknown> => {
  const plugins = new Set<string>()
  const toRules = (levels: Iterable<[string, Level]>, options: (name: string) => unknown[] | undefined) => {
    const rules: Record<string, unknown> = {}

    for (const [name, level] of levels) {
      const rule = oxlintRule(name, context?.typeAware)

      if (!rule) continue

      const ruleOptions = level === 'off' ? undefined : options(name)

      rules[rule] = ruleOptions ? [level, ...ruleOptions] : level

      if (rule.includes('/')) plugins.add(rule.slice(0, rule.indexOf('/')))
    }

    return rules
  }
  const baseOptions = (name: string): unknown[] | undefined => policy.options[name] ?? getRule(name)?.options?.eslint
  const all = toRules(effectiveRules(policy, context), baseOptions)
  // As in ESLint, the rules that need type information are for TypeScript files only: tsgolint
  // would check a JavaScript file too, with the types it can infer. They are off for the rest,
  // since Oxlint has some of them, such as no-floating-promises, on by itself.
  const typed = new Set(Object.values(OXLINT_TYPE_AWARE_RULES))
  const rules = Object.fromEntries(Object.entries(all).map(([rule, value]) => [rule, typed.has(rule) ? 'off' : value]))
  const typeAware = Object.fromEntries(
    Object.entries(all).filter(([rule, value]) => typed.has(rule) && value !== 'off')
  )
  const restricted = importRestrictions(policy, context?.dependencies)

  if (restricted) rules[IMPORTS_RULE] = [restricted.level, restricted.eslint]

  const own = policy.overrides.flatMap(override => {
    const overridden = toRules(
      overrideRules(override, context, policy),
      name => override.options[name] ?? baseOptions(name)
    )

    return Object.keys(overridden).length > 0
      ? [{ files: override.files.map(toEngineGlob), rules: sortKeys(overridden) }]
      : []
  })
  const overrides = [
    ...standardOverrides(context?.technologies),
    ...(Object.keys(typeAware).length > 0 ? [{ files: TYPESCRIPT_FILES, rules: sortKeys(typeAware) }] : []),
    ...own
  ]
  const runtimes = context?.runtimes ?? ['node', 'browser']
  const globals = extraGlobals(runtimes)

  return {
    $schema: './node_modules/oxlint/configuration_schema.json',
    plugins: [...plugins].sort(),
    env: oxlintEnv(runtimes),
    ...(globals.length > 0 ? { globals: Object.fromEntries(globals.map(name => [name, 'readonly'])) } : {}),
    // Oxlint skips node_modules only where a .gitignore lists it, so without one "oxlint --fix" would
    // rewrite the project's dependencies. Pawl never checks these folders, and says so to Oxlint itself.
    ignorePatterns: [...new Set([...ALWAYS_IGNORED, ...configIgnores(policy)])].map(toEngineGlob),
    rules: sortKeys(rules),
    ...(overrides.length > 0 ? { overrides } : {}),
    // Oxlint runs the rules that need type information only with this option, and fails without oxlint-tsgolint.
    ...(context?.typeAware ? { options: { typeAware: true } } : {})
  }
}

/** The keys pawl writes in full into .oxlintrc.json. Any other key is the project's own. */
export const OXLINT_MANAGED_KEYS = ['plugins', 'ignorePatterns', 'rules', 'overrides']

/** The options pawl sets in the project's own `options`, which holds more of the project's choices, such as typeCheck. */
export const OXLINT_MANAGED_OPTIONS = ['typeAware']

/** Keys pawl adds entries to, keeping the ones the project added itself, such as a test framework's globals. */
export const OXLINT_MERGED_KEYS = ['env', 'globals']

/** The .oxlintrc.json to write: the project's file with pawl's part brought up to date. */
export const mergeOxlintConfig = (
  current: Record<string, unknown>,
  expected: Record<string, unknown>
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...current }

  for (const key of OXLINT_MANAGED_KEYS) {
    if (expected[key] === undefined) delete merged[key]
    else merged[key] = expected[key]
  }

  for (const key of OXLINT_MERGED_KEYS) {
    const own = isRecord(current[key]) ? current[key] : {}
    const wanted = isRecord(expected[key]) ? expected[key] : {}

    if (Object.keys({ ...own, ...wanted }).length > 0) merged[key] = { ...own, ...wanted }
  }

  // `options` is the project's, except the keys pawl manages, which are set or removed as the policy calls for.
  const ownOptions = isRecord(current.options) ? current.options : {}
  const wantedOptions = isRecord(expected.options) ? expected.options : {}
  const options = {
    ...Object.fromEntries(Object.entries(ownOptions).filter(([key]) => !OXLINT_MANAGED_OPTIONS.includes(key))),
    ...wantedOptions
  }

  if (Object.keys(options).length > 0) merged.options = options
  else delete merged.options

  return { ...expected, ...merged }
}

export interface OxlintConfigCheck {
  status: 'ok' | 'missing' | 'stale'
  issue?: SetupIssue
}

/** Compare the project's .oxlintrc.json with what the policy calls for. */
export const checkOxlintConfig = (root: string, policy: Policy, context?: OxlintContext): OxlintConfigCheck => {
  const path = join(root, OXLINT_CONFIG_FILE)

  if (!existsSync(path)) {
    return {
      status: 'missing',
      issue: { code: 'oxlint-config-missing', message: `No ${OXLINT_CONFIG_FILE} found.`, fix: 'Run "pawl sync".' }
    }
  }

  const current = readJsonc<Record<string, unknown>>(path).value
  const expected = oxlintConfig(policy, context)
  const same = (key: string): boolean => sameJson(current?.[key], expected[key])
  const covers = (key: string): boolean => {
    const own = isRecord(current?.[key]) ? (current[key] as Record<string, unknown>) : {}
    const wanted = isRecord(expected[key]) ? expected[key] : {}

    return Object.entries(wanted).every(([name, value]) => own[name] === value)
  }

  const optionsSame = (): boolean => {
    const own = isRecord(current?.options) ? current.options : {}
    const wanted = isRecord(expected.options) ? expected.options : {}

    return OXLINT_MANAGED_OPTIONS.every(key => own[key] === wanted[key])
  }

  if (current && OXLINT_MANAGED_KEYS.every(same) && OXLINT_MERGED_KEYS.every(covers) && optionsSame()) {
    return { status: 'ok' }
  }

  return {
    status: 'stale',
    issue: {
      code: 'oxlint-config-stale',
      message: `${OXLINT_CONFIG_FILE} is out of date with the policy.`,
      fix: 'Run "pawl sync".'
    }
  }
}

/**
 * The command oxlint-tsgolint installs, looked for in the node_modules folders from the project up,
 * as Oxlint looks. Only the project's own copy counts: adding it is the project's choice.
 */
export const resolveTsgolint = (root: string): string | undefined => {
  for (const dir of ancestors(root)) {
    const folder = join(dir, 'node_modules', TYPE_AWARE_PACKAGE)
    const bin = readJson<{ bin?: string | Record<string, string> }>(join(folder, 'package.json'))?.bin
    const entry = typeof bin === 'string' ? bin : bin?.tsgolint

    if (entry) return join(folder, entry)
  }

  return undefined
}

/** True when oxlint-tsgolint can run for this project, so Oxlint can enforce the rules that need type information. */
export const tsgolintInstalled = (root: string): boolean =>
  process.env.OXLINT_TSGOLINT_PATH !== undefined || resolveTsgolint(root) !== undefined
