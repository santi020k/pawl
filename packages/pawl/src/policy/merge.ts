import { getGuard } from '../catalog/guards.ts'
import { canonicalName, defaultLevel, getRule, scopedRule } from '../catalog/rules.ts'
import { expandBraces, literalBrackets } from '../project/ignores.ts'
import { findOwnRule } from '../scans/registry.ts'
import {
  type Level,
  type Override,
  type Policy,
  type PolicyInput,
  type SetupIssue,
  type StyleOptions
} from '../types.ts'
import { isRecord } from '../utils/json.ts'
import { toList } from '../utils/list.ts'

export const DEFAULT_STYLE: StyleOptions = {
  indent: 2,
  lineWidth: 120,
  quotes: 'single',
  semicolons: false,
  trailingCommas: 'none',
  arrowParens: 'as-needed'
}

const ORDER: Record<Level, number> = { off: 0, warn: 1, error: 2 }

/** Identity helper that gives `pawl.config.ts` and policy packages their types. */
export const definePolicy = (policy: PolicyInput): PolicyInput => policy

export interface Layer {
  input: PolicyInput
  source: string
}

const emptyPolicy = (): Policy => ({
  engine: 'auto',
  formatter: 'auto',
  packs: [],
  strict: false,
  style: { ...DEFAULT_STYLE },
  rules: {},
  options: {},
  biomeOptions: {},
  overrides: [],
  locked: [],
  ignore: [],
  gitignore: true,
  defaultIgnores: true,
  runtime: undefined,
  detect: { enabled: true, exclude: [] },
  maxWarnings: undefined,
  lockViolations: [],
  sources: ['pawl defaults']
})

/**
 * Merge policy layers, earliest first. Later layers win, with two exceptions that keep a
 * company standard enforceable: `strict` can be turned on but not off, and a locked rule
 * can be tightened but not loosened.
 */
export const mergeLayers = (layers: readonly Layer[]): Policy => {
  const policy = emptyPolicy()

  for (const { input, source } of layers) {
    policy.sources.push(source)

    if (input.engine) policy.engine = input.engine

    if (input.formatter) policy.formatter = input.formatter

    for (const pack of input.packs ?? []) {
      if (!policy.packs.includes(pack)) policy.packs.push(pack)
    }

    if (input.strict) policy.strict = true

    if (input.style) policy.style = { ...policy.style, ...input.style }

    if (input.maxWarnings !== undefined) {
      policy.maxWarnings = Math.min(policy.maxWarnings ?? Number.POSITIVE_INFINITY, input.maxWarnings)
    }

    for (const [given, level] of Object.entries(input.rules ?? {})) {
      const name = canonicalName(given)
      const kept = lockedLevel(policy, name, level)

      if (kept === undefined) policy.rules[name] = level
      else policy.lockViolations.push({ rule: name, wanted: level, kept, source })
    }

    for (const [given, value] of Object.entries(input.options ?? {})) policy.options[canonicalName(given)] = [...value]

    Object.assign(policy.biomeOptions, biomeOptionsOf(input.biomeOptions, source))

    for (const given of input.locked ?? []) {
      const name = canonicalName(given)

      if (!policy.locked.includes(name)) policy.locked.push(name)
    }

    for (const pattern of (input.ignore ?? []).flatMap(expandBraces).map(literalBrackets)) {
      if (!policy.ignore.includes(pattern)) policy.ignore.push(pattern)
    }

    for (const override of input.overrides ?? []) policy.overrides.push(mergeOverride(policy, override, source))

    if (input.gitignore !== undefined) policy.gitignore = input.gitignore

    if (input.defaultIgnores !== undefined) policy.defaultIgnores = input.defaultIgnores

    if (input.runtime !== undefined) policy.runtime = [...new Set(toList(input.runtime))]

    if (input.detect === false || input.detect === true) policy.detect = { ...policy.detect, enabled: input.detect }
    else if (input.detect) {
      policy.detect = {
        enabled: true,
        exclude: [...new Set([...policy.detect.exclude, ...(input.detect.exclude ?? [])])]
      }
    }
  }

  requireLevels(policy)

  return policy
}

/**
 * Options for Biome by canonical rule name. Biome refuses options for a rule it does not have,
 * so a name without a Biome rule is refused here, where the message can say which policy named it.
 */
const biomeOptionsOf = (
  input: Record<string, Record<string, unknown>> | undefined,
  source: string
): Record<string, Record<string, unknown>> => {
  const out: Record<string, Record<string, unknown>> = {}

  for (const [given, value] of Object.entries(input ?? {})) {
    const name = canonicalName(given)

    if (!isRecord(value)) {
      throw new Error(
        `${source} gives "${given}" Biome options that are not an object. Use Biome's own shape: { ... }.`
      )
    }

    if (scopedRule(name, 'biome') === undefined && !getRule(name)?.biome) {
      throw new Error(
        `${source} gives Biome options to "${given}", which Biome does not enforce. Use \`options\` for ESLint and Oxlint, or name Biome's rule as biome:group/name.`
      )
    }

    out[name] = { ...value }
  }

  return out
}

/** A rule only Biome has is off until the policy gives it a level, so options alone would do nothing. */
const requireLevels = (policy: Policy): void => {
  const named = [policy.biomeOptions, ...policy.overrides.map(override => override.biomeOptions)].flatMap(Object.keys)
  const leveled = (name: string): boolean =>
    name in policy.rules || policy.overrides.some(override => name in override.rules && name in override.biomeOptions)
  const missing = [...new Set(named)].filter(name => scopedRule(name, 'biome') !== undefined && !leveled(name))

  if (missing.length > 0) {
    throw new Error(
      `The policy gives Biome options to ${missing.join(', ')} but no level. Add ${missing.length === 1 ? 'it' : 'them'} to \`rules\`, for example '${missing[0]}': 'error'.`
    )
  }
}

/**
 * The level of one of pawl's own checks that are not in the rule catalog: the Docker and Markdown
 * checks and the guards. A lock keeps them at it, as it keeps a catalog rule at its default.
 */
const ownLevel = (policy: Policy, name: string): Level | undefined => {
  const guard = name.startsWith('pawl/') ? getGuard(name.slice('pawl/'.length)) : undefined
  // An opt-in guard the policy has not switched on is off, so there is nothing to keep.
  const guardOn = guard !== undefined && (!guard.optIn || policy.packs.includes(guard.name))

  return findOwnRule(name)?.rule.level ?? (guardOn ? (guard.level ?? 'error') : undefined)
}

/**
 * The level a locked rule keeps when a layer asks for a looser one, or undefined when the
 * asked-for level is allowed. The rule's own default, or the level a layer set, is the floor.
 */
const lockedLevel = (policy: Policy, name: string, wanted: Level): Level | undefined => {
  const current = policy.rules[name] ?? ownLevel(policy, name) ?? defaultLevel(name, policy.strict)

  return policy.locked.includes(name) && ORDER[wanted] < ORDER[current] ? current : undefined
}

/** An override with rule names made canonical. A locked rule cannot be loosened for some files either. */
const mergeOverride = (
  policy: Policy,
  override: NonNullable<PolicyInput['overrides']>[number],
  source: string
): Override => {
  const rules: Record<string, Level> = {}

  for (const [given, level] of Object.entries(override.rules ?? {})) {
    const name = canonicalName(given)
    const kept = lockedLevel(policy, name, level)

    rules[name] = kept ?? level

    if (kept !== undefined)
      policy.lockViolations.push({ rule: name, wanted: level, kept, source: `${source} (overrides)` })
  }

  const options = Object.fromEntries(
    Object.entries(override.options ?? {}).map(([given, value]) => [canonicalName(given), [...value]])
  )

  return {
    files: override.files.flatMap(expandBraces).map(literalBrackets),
    rules,
    options,
    biomeOptions: biomeOptionsOf(override.biomeOptions, `${source} (overrides)`)
  }
}

/** A setup problem for each time a layer tried to loosen a rule a policy it extends had locked. */
export const lockIssues = (policy: Pick<Policy, 'lockViolations'>): SetupIssue[] =>
  policy.lockViolations.map(violation => ({
    code: 'locked-rule',
    message: `"${violation.rule}" is locked at "${violation.kept}" by the policy this repo extends. ${violation.source} tried to set it to "${violation.wanted}".`,
    fix: `Remove the "${violation.rule}" override from ${violation.source}.`
  }))

/** The policy with no config at all. */
export const defaultPolicy = (): Policy => mergeLayers([])
