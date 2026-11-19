import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readJson, readJsonc, toPosix } from '../fs-utils.ts'
import { IMPORTS_RULE, importRestrictions } from '../guards.ts'
import { effectiveRules, type RuleContext } from '../policy.ts'
import { getRule } from '../rules.ts'
import { type Finding, type Policy, type SetupIssue } from '../types.ts'
import { type EngineRun, type RunOptions } from './biome.ts'
import { OXLINT_RULES } from './oxlint-rules.ts'
import { EngineError, runNode } from './run.ts'

export const OXLINT_CONFIG_FILE = '.oxlintrc.json'

const DEFAULT_IGNORES = [
  '**/dist',
  '**/build',
  '**/coverage',
  '**/.next',
  '**/.astro',
  '**/.nuxt',
  '**/.output',
  '**/.turbo'
]

/** Oxlint's own name back to the neutral one, for reading its report. */
const NEUTRAL = new Map(Object.entries(OXLINT_RULES).map(([name, rule]) => [rule, name]))

/** True when Oxlint enforces this rule of the standard. */
export const oxlintCovers = (name: string): boolean => OXLINT_RULES[name] !== undefined

/**
 * The Oxlint configuration for a policy. Oxlint refuses a rule it does not know, so only the
 * rules in `OXLINT_RULES` are written; the rest are left to ESLint or reported by `pawl doctor`.
 */
export const oxlintConfig = (policy: Policy, context?: RuleContext): Record<string, unknown> => {
  const rules: Record<string, unknown> = {}
  const plugins = new Set<string>()

  for (const [name, level] of effectiveRules(policy, context)) {
    const rule = name.startsWith('oxlint:') ? name.slice('oxlint:'.length) : OXLINT_RULES[name]

    if (!rule) continue

    const options = level === 'off' ? undefined : (policy.options[name] ?? getRule(name)?.options?.eslint)

    rules[rule] = options ? [level, ...options] : level

    if (rule.includes('/')) plugins.add(rule.slice(0, rule.indexOf('/')))
  }

  const restricted = importRestrictions(policy, context?.dependencies)

  if (restricted) rules[IMPORTS_RULE] = [restricted.level, restricted.eslint]

  return {
    $schema: './node_modules/oxlint/configuration_schema.json',
    plugins: [...plugins].sort(),
    ignorePatterns: [...DEFAULT_IGNORES, ...policy.ignore],
    rules: Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)))
  }
}

export interface OxlintConfigCheck {
  status: 'ok' | 'missing' | 'stale'
  issue?: SetupIssue
}

/** Compare the project's .oxlintrc.json with what the policy calls for. */
export const checkOxlintConfig = (root: string, policy: Policy, context?: RuleContext): OxlintConfigCheck => {
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

  if (current && same('rules') && same('plugins') && same('ignorePatterns')) return { status: 'ok' }

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
  const start = result.stdout.indexOf('{')

  if (start === -1) {
    throw new EngineError((result.stderr || result.stdout).trim() || `Oxlint exited with code ${result.code}.`, {
      command: result.command
    })
  }

  let report: { diagnostics?: OxlintDiagnostic[] }

  try {
    report = JSON.parse(result.stdout.slice(start)) as typeof report
  } catch (cause) {
    throw new EngineError(`Could not read Oxlint's report.\n${result.stderr.trim()}`, {
      command: result.command,
      cause
    })
  }

  return { findings: (report.diagnostics ?? []).map(toFinding), command: result.command.replace(' --format json', '') }
}
