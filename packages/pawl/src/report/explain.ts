import { defaultLevel, findRule } from '../catalog/rules.ts'
import { OXLINT_RULES } from '../engines/oxlint/rules.ts'
import { effectiveRules } from '../policy/levels.ts'
import { findOwnRule } from '../scans/registry.ts'
import { type Policy } from '../types.ts'
import { kebabCase } from '../utils/text.ts'

/**
 * What `pawl explain` shows for a rule: what it does, the level it has under this policy and
 * why, and which engine enforces it under which name. Undefined when pawl does not know the rule.
 */
export const explainRule = (policy: Policy, query: string): string[] | undefined => {
  const def = findRule(query)
  const own = def ? undefined : findOwnRule(query)

  if (own) {
    const { rule, scan } = own
    const level = policy.rules[rule.name] ?? rule.level

    return [
      rule.name,
      `  ${rule.summary}`,
      '',
      `  Level here:  ${level}${level === rule.level ? '' : `; the standard has ${rule.level}`}`,
      `  Checked by:  pawl, in ${scan.reads}`,
      '',
      `  How to fix:  ${rule.advice}`
    ]
  }

  if (!def) return undefined

  const level = effectiveRules(policy).get(def.name) ?? 'off'
  const base = defaultLevel(def.name, policy.strict)
  const standard = policy.strict && def.strict ? 'strict standard' : 'default standard'
  const reason =
    policy.rules[def.name] === undefined ? standard : `set by ${policy.sources.slice(1).join(', ') || 'the policy'}`
  const lines = [
    `${def.name}`,
    `  ${def.summary}`,
    '',
    `  Level here:  ${level} (${reason}${level === base ? '' : `; the standard has ${base}`})`
  ]

  if (policy.locked.includes(def.name)) lines.push('  Locked:      yes, this repo cannot loosen it')

  if (def.tag === 'pawl') {
    lines.push('  Checked by:  pawl')
  } else {
    const page = def.biome ? `https://biomejs.dev/linter/rules/${kebabCase(def.biome.split('/')[1] ?? '')}` : ''

    lines.push(
      `  Biome:       ${def.biome ? `${def.biome}  ${page}` : 'no equivalent'}`,
      `  Oxlint:      ${OXLINT_RULES[def.name] ?? 'no equivalent'}`,
      `  ESLint:      ${def.name}`
    )
  }

  if (def.guardrail) lines.push('  Guardrail:   yes, guards against a common mistake of coding agents')

  if (def.advice) lines.push('', `  How to fix:  ${def.advice}`)

  return lines
}
