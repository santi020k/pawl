import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IMPORTS_RULE, importRestrictions } from '../../catalog/guards.ts'
import { getRule, scopedRule } from '../../catalog/rules.ts'
import { extraGlobals, oxlintEnv } from '../../catalog/runtimes.ts'
import { effectiveRules, overrideRules, type RuleContext } from '../../policy/levels.ts'
import { OXLINT_CONFIG_FILE } from '../../project/config-files.ts'
import { allTechnologies, type Detection } from '../../project/detect.ts'
import { configIgnores, toEngineGlob } from '../../project/ignores.ts'
import { type Level, type Policy, type Runtime, type SetupIssue } from '../../types.ts'
import { isRecord, readJsonc, sameJson, sortKeys } from '../../utils/json.ts'
import { OXLINT_RULES } from './rules.ts'

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
const oxlintRule = (name: string): string | undefined => scopedRule(name, 'oxlint') ?? OXLINT_RULES[name]

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
    ignorePatterns: configIgnores(policy).map(toEngineGlob),
    rules: sortKeys(rules),
    ...(overrides.length > 0 ? { overrides } : {})
  }
}

/** The keys pawl writes in full into .oxlintrc.json. Any other key is the project's own. */
export const OXLINT_MANAGED_KEYS = ['plugins', 'ignorePatterns', 'rules', 'overrides']

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
