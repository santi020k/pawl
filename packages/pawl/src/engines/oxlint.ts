import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse } from 'node:path'
import { allTechnologies, type Detection } from '../detect.ts'
import { readJson, readJsonc, toPosix } from '../fs-utils.ts'
import { IMPORTS_RULE, importRestrictions } from '../guards.ts'
import { ALWAYS_IGNORED, configIgnores, toEngineGlob } from '../ignores.ts'
import { effectiveRules, overrideRules, type RuleContext } from '../policy.ts'
import { getRule, type Technology } from '../rules.ts'
import { extraGlobals, oxlintEnv } from '../runtime.ts'
import { type Finding, type Level, type Policy, type Runtime, type SetupIssue } from '../types.ts'
import { type EngineRun, type RunOptions } from './biome.ts'
import { OXLINT_RULES, OXLINT_TYPE_AWARE_RULES } from './oxlint-rules.ts'
import { EngineError, readReport, runChunked, runNode } from './run.ts'

export const OXLINT_CONFIG_FILE = '.oxlintrc.json'

/** Oxlint's own name back to the neutral one, for reading its report. */
const NEUTRAL = new Map(
  [...Object.entries(OXLINT_RULES), ...Object.entries(OXLINT_TYPE_AWARE_RULES)].map(([name, rule]) => [rule, name])
)

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
  name.startsWith('oxlint:')
    ? name.slice('oxlint:'.length)
    : (OXLINT_RULES[name] ?? (typeAware ? OXLINT_TYPE_AWARE_RULES[name] : undefined))

const sortKeys = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

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
  const rules = toRules(effectiveRules(policy, context), baseOptions)
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
  const overrides = [...standardOverrides(context?.technologies), ...own]
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
  const same = (key: string): boolean => JSON.stringify(current?.[key]) === JSON.stringify(expected[key])
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

const resolveBin = (root: string): string | undefined => {
  for (const from of [join(root, 'package.json'), import.meta.filename]) {
    try {
      const manifestPath = createRequire(from).resolve('oxlint/package.json')
      const bin = readJson<{ bin?: string | Record<string, string> }>(manifestPath)?.bin
      const entry = typeof bin === 'string' ? bin : bin?.oxlint

      if (entry) return join(dirname(manifestPath), entry)
    } catch {
      // Try the next place.
    }
  }

  return undefined
}

export const oxlintInstalled = (root: string): boolean => resolveBin(root) !== undefined

/**
 * The command oxlint-tsgolint installs, looked for in the node_modules folders from the project up,
 * as Oxlint looks. Only the project's own copy counts: adding it is the project's choice.
 */
const resolveTsgolint = (root: string): string | undefined => {
  for (let dir = root; ; dir = dirname(dir)) {
    const folder = join(dir, 'node_modules', TYPE_AWARE_PACKAGE)
    const bin = readJson<{ bin?: string | Record<string, string> }>(join(folder, 'package.json'))?.bin
    const entry = typeof bin === 'string' ? bin : bin?.tsgolint

    if (entry) return join(folder, entry)

    if (dir === parse(dir).root) return undefined
  }
}

/** True when oxlint-tsgolint can run for this project, so Oxlint can enforce the rules that need type information. */
export const tsgolintInstalled = (root: string): boolean =>
  process.env.OXLINT_TSGOLINT_PATH !== undefined || resolveTsgolint(root) !== undefined

/**
 * Where to tell Oxlint to find tsgolint, or undefined when it finds it itself. Oxlint looks for
 * node_modules/.bin/tsgolint from the project up, and only there, so a copy it cannot see, as in
 * a layout without a .bin folder, has to be named.
 */
const tsgolintEnv = (root: string): Record<string, string> | undefined => {
  const bin = process.env.OXLINT_TSGOLINT_PATH === undefined ? resolveTsgolint(root) : undefined

  if (!bin) return undefined

  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules/.bin/tsgolint'))) return undefined

    if (dir === parse(dir).root) break
  }

  return { OXLINT_TSGOLINT_PATH: bin }
}

interface OxlintDiagnostic {
  message: string
  code?: string
  severity: string
  filename?: string
  help?: string
  labels?: Array<{ span?: { line?: number; column?: number } }>
}

/** The diagnostic Oxlint gives when tsgolint cannot read the project's tsconfig. */
const TSCONFIG_ERROR = 'typescript(tsconfig-error)'

/** Oxlint's rule name as it appears in a config: core rules bare, the rest as plugin/rule. */
const oxlintName = (scope: string, rule: string): string =>
  scope === 'eslint' ? rule : `${scope.replaceAll('_', '-')}/${rule}`

const toFinding = (diagnostic: OxlintDiagnostic): Finding => {
  // Oxlint reports a rule as "scope(rule)", such as "eslint(no-var)" or "typescript(no-explicit-any)".
  const match = /^([\w-]+)\((.+)\)$/.exec(diagnostic.code ?? '')
  const engineRule = match ? oxlintName(match[1] as string, match[2] as string) : (diagnostic.code ?? 'parse')
  const span = diagnostic.labels?.[0]?.span

  return {
    file: toPosix(diagnostic.filename ?? ''),
    line: Math.max(1, span?.line ?? 1),
    column: Math.max(1, span?.column ?? 1),
    engine: 'oxlint',
    engineRule,
    rule: NEUTRAL.get(engineRule) ?? `oxlint:${engineRule}`,
    severity: diagnostic.severity === 'error' ? 'error' : 'warn',
    message: diagnostic.message,
    fixable: false
  }
}

/** Run the project's Oxlint and turn its report into findings. */
export const runOxlint = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root)

  if (!bin)
    throw new EngineError('Oxlint is not installed in this project. Add oxlint with your package manager.', {
      command: 'oxlint'
    })

  const flags = ['--format', 'json', ...(write ? ['--fix'] : [])]

  return runChunked(files, write ? 'oxlint --fix' : 'oxlint', async targets => {
    const result = await runNode(bin, [...flags, ...targets], root, 'oxlint', tsgolintEnv(root))

    if (!result.stdout.includes('{')) {
      throw new EngineError((result.stderr || result.stdout).trim() || `Oxlint exited with code ${result.code}.`, {
        command: result.command
      })
    }

    const report = readReport<{ diagnostics?: OxlintDiagnostic[] }>(result.stdout, '{')

    if (!report || typeof report !== 'object') {
      throw new EngineError(`Could not read Oxlint's report.\n${result.stderr.trim()}`.trim(), {
        command: result.command
      })
    }

    const diagnostics = report.diagnostics ?? []
    const tsconfig = diagnostics.find(diagnostic => diagnostic.code === TSCONFIG_ERROR)

    // tsgolint reports a tsconfig it cannot read as one diagnostic and then runs none of the rules
    // that need type information, so the check did not run in full.
    if (tsconfig) {
      throw new EngineError(
        [
          `Oxlint could not read ${tsconfig.filename ?? 'the tsconfig'}, so the rules that need type information did not run.`,
          [tsconfig.message, tsconfig.help].filter(Boolean).join(': ')
        ].join('\n'),
        { command: result.command }
      )
    }

    return diagnostics.map(toFinding)
  })
}
