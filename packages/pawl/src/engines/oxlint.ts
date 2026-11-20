import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { allTechnologies, type Detection } from '../detect.ts'
import { readJson, readJsonc, toPosix } from '../fs-utils.ts'
import { IMPORTS_RULE, importRestrictions } from '../guards.ts'
import { ALWAYS_IGNORED, configIgnores, toEngineGlob } from '../ignores.ts'
import { effectiveRules, overrideRules, type RuleContext } from '../policy.ts'
import { getRule } from '../rules.ts'
import { extraGlobals, oxlintEnv } from '../runtime.ts'
import { type Finding, type Level, type Policy, type Runtime, type SetupIssue } from '../types.ts'
import { type EngineRun, type RunOptions } from './biome.ts'
import { OXLINT_RULES } from './oxlint-rules.ts'
import { EngineError, readReport, runNode } from './run.ts'

export const OXLINT_CONFIG_FILE = '.oxlintrc.json'

/** Oxlint's own name back to the neutral one, for reading its report. */
const NEUTRAL = new Map(Object.entries(OXLINT_RULES).map(([name, rule]) => [rule, name]))

/** True when Oxlint enforces this rule of the standard. */
export const oxlintCovers = (name: string): boolean => OXLINT_RULES[name] !== undefined

export interface OxlintContext extends RuleContext {
  /** Where the code runs, for the globals Oxlint knows. Node and the browser when not given. */
  runtimes?: readonly Runtime[]
}

/** The Oxlint context for a project. One Oxlint config covers the whole repo, so it takes every technology in it. */
export const oxlintContextFor = (detection: Detection): OxlintContext => ({
  typescript: true,
  technologies: allTechnologies(detection),
  dependencies: detection.dependencies,
  runtimes: detection.runtimes
})

/** Oxlint's name for a rule of the standard, or undefined when Oxlint does not have it. */
const oxlintRule = (name: string): string | undefined =>
  name.startsWith('oxlint:') ? name.slice('oxlint:'.length) : OXLINT_RULES[name]

const sortKeys = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

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
      const rule = oxlintRule(name)

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

  const overrides = policy.overrides.flatMap(override => {
    const overridden = toRules(
      overrideRules(override, context, policy),
      name => override.options[name] ?? baseOptions(name)
    )

    return Object.keys(overridden).length > 0
      ? [{ files: override.files.map(toEngineGlob), rules: sortKeys(overridden) }]
      : []
  })
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
    ...(overrides.length > 0 ? { overrides } : {})
  }
}

/** The keys pawl writes in full into .oxlintrc.json. Any other key is the project's own. */
export const OXLINT_MANAGED_KEYS = ['plugins', 'ignorePatterns', 'rules', 'overrides']

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

  if (current && OXLINT_MANAGED_KEYS.every(same) && OXLINT_MERGED_KEYS.every(covers)) return { status: 'ok' }

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

interface OxlintDiagnostic {
  message: string
  code?: string
  severity: string
  filename?: string
  labels?: Array<{ span?: { line?: number; column?: number } }>
}

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

  const args = ['--format', 'json', ...(write ? ['--fix'] : []), ...(files && files.length > 0 ? files : ['.'])]
  const result = await runNode(bin, args, root, 'oxlint')

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

  return { findings: (report.diagnostics ?? []).map(toFinding), command: result.command.replace(' --format json', '') }
}
