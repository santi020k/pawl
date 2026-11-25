import { activeGuards, type Guard, getGuard, guardLevel } from '../catalog/guards.ts'
import { defaultLevel, findRule, LANGUAGE_ENGINES } from '../catalog/rules.ts'
import { oxlintCatalogName } from '../engines/oxlint/config.ts'
import { OXLINT_RULES, OXLINT_TYPE_AWARE_RULES } from '../engines/oxlint/rules.ts'
import { effectiveRules } from '../policy/levels.ts'
import { detect } from '../project/detect.ts'
import { findOwnRule } from '../scans/registry.ts'
import { type LanguageEngine, type Policy } from '../types.ts'
import { kebabCase } from '../utils/text.ts'

/** Findings pawl names itself that are neither in the catalog nor a check of its own. */
const OWN_RULES: Record<string, { summary: string; checkedBy: string; advice: string }> = {
  'biome:complexity/noImportantStyles': {
    summary: 'Avoid CSS declarations that bypass the normal cascade.',
    checkedBy: 'Biome',
    advice:
      'Check cascade layers and specificity first. Keep necessary reduced-motion or generated-theme overrides; document a narrow policy exception and test rendered behavior before removing !important.'
  },
  'prettier:parse': {
    summary: 'Prettier cannot parse the file, so it cannot tell whether the file is formatted.',
    checkedBy: 'Prettier',
    advice: 'Fix the syntax error at the line and column given. Pawl cannot fix it.'
  },
  'eslint:parse': {
    summary: 'ESLint cannot parse the file, so none of its rules ran on it.',
    checkedBy: 'ESLint',
    advice:
      'Fix the syntax error at the line and column given. If the file is valid, ESLint has no parser for its language: run "pawl doctor".'
  },
  'eslint:unused-disable-directive': {
    summary: 'An eslint-disable or eslint-enable comment that switches off no finding, so it only hides future ones.',
    checkedBy: 'ESLint',
    advice: 'Run "pawl fix", which removes the comment, or remove the rule it names that reports nothing there.'
  },
  'oxlint:parse': {
    summary: 'Oxlint cannot parse the file, so none of its rules ran on it.',
    checkedBy: 'Oxlint',
    advice: 'Fix the syntax error at the line and column given. Pawl cannot fix it.'
  },
  'biome:parse': {
    summary: 'Biome cannot parse the file, so it can neither lint nor format it.',
    checkedBy: 'Biome',
    advice: 'Fix the syntax error at the line and column given. Pawl cannot fix it.'
  },
  'sort-package-json': {
    summary: 'The fields of package.json are not in the usual order.',
    checkedBy: 'Biome, as a source action',
    advice: 'Run "pawl fix".'
  }
}

/** The tools of the other languages, as people call them. */
const LANGUAGE_TOOL_TITLES: Record<LanguageEngine, string> = {
  clippy: 'Clippy',
  rustc: 'the Rust compiler',
  rustfmt: 'rustfmt',
  swiftlint: 'SwiftLint',
  swiftformat: 'SwiftFormat',
  'swift-format': 'swift-format',
  ktlint: 'ktlint'
}

/**
 * A name pawl gives a finding of an engine's own, with no rule of the catalog behind it, such as
 * `biome:style/noDefaultExport`, `biome:fs/cantRead`, `oxlint:unicorn/no-null` or `clippy:needless_return`.
 */
const engineName = (query: string): { title: string; name: string; docs?: string } | undefined => {
  const [prefix, ...rest] = query.split(':')
  const name = rest.join(':')

  if (name === '') return undefined

  if (prefix === 'biome') {
    const rule =
      /^(?:lint\/)?(?:a11y|complexity|correctness|nursery|performance|security|style|suspicious)\/(\w+)$/.exec(name)

    return {
      title: 'Biome',
      name,
      ...(rule ? { docs: `https://biomejs.dev/linter/rules/${kebabCase(rule[1] ?? '')}/` } : {})
    }
  }

  if (prefix === 'oxlint') {
    const rule = /^(?:([\w-]+)\/)?([\w-]+)$/.exec(name)
    const scope = rule?.[1] === undefined ? 'eslint' : rule[1].replaceAll('-', '_')

    return {
      title: 'Oxlint',
      name,
      ...(rule ? { docs: `https://oxc.rs/docs/guide/usage/linter/rules/${scope}/${rule[2]}.html` } : {})
    }
  }

  const tool = LANGUAGE_ENGINES.find(engine => engine === prefix)

  if (tool) return { title: LANGUAGE_TOOL_TITLES[tool], name }

  return prefix === 'eslint' ? { title: 'ESLint', name } : undefined
}

/** What a guard refuses, the level it runs at, and, given the project's root, whether it is on there. */
const explainGuard = (guard: Guard, policy: Policy, root: string | undefined): string[] => {
  const level = guardLevel(policy, guard)
  const refused = [
    ...new Set([...(guard.paths ?? []), ...(guard.patterns ?? []), ...(guard.syntax ?? [])].map(entry => entry.message))
  ]
  const whenOff = guard.optIn
    ? `no. Switch it on with "pawl add ${guard.name}"`
    : `no. It switches on when the project depends on ${guard.when.join(', ')}`
  const runners = [
    ...(guard.paths || guard.patterns ? ['the imports by the linter in use'] : []),
    ...(guard.syntax ? ['the code patterns by Biome, as rules pawl writes, or by ESLint'] : [])
  ]
  const on = root !== undefined && activeGuards(detect(root, policy).dependencies, policy.packs).includes(guard)

  return [
    `pawl/${guard.name}`,
    `  The ${guard.title} guard: imports and code that pawl refuses, with no plugin.`,
    '',
    ...(root === undefined ? [] : [`  On here:     ${on ? 'yes' : whenOff}`]),
    ...(guard.syntax
      ? [`  Level here:  ${level}${policy.rules[`pawl/${guard.name}`] === undefined ? '' : ' (set by the policy)'}`]
      : []),
    `  Checked by:  ${runners.join('; ')}`,
    '',
    '  It refuses:',
    ...refused.map(message => `    - ${message}`)
  ]
}

/**
 * What `pawl explain` shows for a rule: what it does, the level it has under this policy and
 * why, and which engine enforces it under which name. Undefined when pawl does not know the rule.
 * `root` is the project, which says whether a guard is on there.
 */
export const explainRule = (policy: Policy, query: string, root?: string): string[] | undefined => {
  // The names the output prints for a rule of the catalog, such as `oxlint:typescript/no-floating-promises`
  // in the agent format or `typescript/no-floating-promises` in the pretty one, lead to that rule.
  const bare = /^(?:oxlint|biome|eslint):(.+)$/.exec(query)?.[1]
  const fromOxlint = oxlintCatalogName(bare ?? query)
  const def =
    findRule(query) ??
    (bare === undefined ? undefined : findRule(bare)) ??
    (fromOxlint === undefined ? undefined : findRule(fromOxlint))
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

  // Pawl's own names are also taken without their "pawl/".
  const short = query.replace(/^pawl\//, '')
  const guard = def ? undefined : getGuard(short)

  if (guard) return explainGuard(guard, policy, root)

  const named = def ? undefined : OWN_RULES[short]

  if (named) {
    return [
      short.includes(':') ? short : `pawl/${short}`,
      `  ${named.summary}`,
      '',
      `  Checked by:  ${named.checkedBy}`,
      '',
      `  How to fix:  ${named.advice}`
    ]
  }

  const engine = def ? undefined : engineName(query)

  if (engine) {
    return [
      query,
      `  A diagnostic of ${engine.title} that is not a rule of pawl's catalog. Pawl reports it under ${engine.title}'s own name, ${engine.name}, with its level.`,
      '',
      `  Checked by:  ${engine.title}`,
      ...(engine.docs ? ['', `  Read more:   ${engine.docs}`] : [])
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
      `  Oxlint:      ${OXLINT_RULES[def.name] ?? (OXLINT_TYPE_AWARE_RULES[def.name] ? `${OXLINT_TYPE_AWARE_RULES[def.name]} (needs oxlint-tsgolint)` : 'no equivalent')}`,
      `  ESLint:      ${def.name}`
    )
  }

  if (def.guardrail) lines.push('  Guardrail:   yes, guards against a common mistake of coding agents')

  if (def.advice) lines.push('', `  How to fix:  ${def.advice}`)

  return lines
}
