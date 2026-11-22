import { defaultLevel, getRule, isGated, RULES, type Technology } from '../catalog/rules.ts'
import { type Level, type Override, type Policy } from '../types.ts'

export interface RuleContext {
  typescript?: boolean
  /** The technologies the project uses. Rules for any other technology are left out. */
  technologies?: readonly Technology[]
  /** Every dependency in the repo. Switches on the guards for the libraries it uses. */
  dependencies?: readonly string[]
}

/**
 * The level of every rule: catalog defaults, then the policy's overrides.
 * With a context, rules for technology the project does not use are left out.
 */
export const effectiveRules = (policy: Policy, context?: RuleContext): Map<string, Level> => {
  const levels = new Map<string, Level>()

  for (const def of RULES) {
    if (ruleApplies(def.name, context)) levels.set(def.name, defaultLevel(def.name, policy.strict))
  }

  for (const [name, level] of Object.entries(policy.rules)) {
    if (ruleApplies(name, context)) levels.set(name, level)
  }

  return levels
}

/** True when a rule applies to a project: always without a context, else when the project uses its technology. */
export const ruleApplies = (name: string, context?: RuleContext): boolean => {
  const def = getRule(name)

  if (!context || !def) return true

  if (def.tag === 'typescript') return context.typescript === true

  return !isGated(def.tag) || (context.technologies ?? []).includes(def.tag)
}

/**
 * The rules of one override that apply to the project, in the order the override names them.
 * A rule the override gives options but no level keeps the level it has, unless that is off.
 * `options` are the options that engine takes: ESLint's shape by default, or `biomeOptions`.
 */
export const overrideRules = (
  override: Override,
  context?: RuleContext,
  policy?: Policy,
  options: Readonly<Record<string, unknown>> = override.options
): [string, Level][] => {
  const levels = policy ? effectiveRules(policy, context) : new Map<string, Level>()
  const optionsOnly = Object.keys(options).flatMap((name): [string, Level][] => {
    const level = levels.get(name)

    return name in override.rules || level === undefined || level === 'off' ? [] : [[name, level]]
  })

  return [...Object.entries(override.rules).filter(([name]) => ruleApplies(name, context)), ...optionsOnly]
}
