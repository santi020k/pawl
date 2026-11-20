import { BASELINE_FILE, baselineUnreadable, readBaseline } from './baseline.ts'
import { installedVersion, satisfies } from './compat.ts'
import { describe, detect, filePacks } from './detect.ts'
import {
  BIOME_PRESET,
  BIOME_VERSION,
  biomeContextFor,
  biomeInstalled,
  checkBiomeConfig,
  extendsPackage,
  presetInstalled
} from './engines/biome.ts'
import { eslintInstalled, eslintPlanFor } from './engines/eslint.ts'
import {
  checkOxlintConfig,
  NO_OXLINT_EQUIVALENT,
  OXLINT_CONFIG_FILE,
  oxlintContextFor,
  oxlintGaps,
  oxlintInstalled,
  TYPE_AWARE_PACKAGE,
  tsgolintInstalled
} from './engines/oxlint.ts'
import { checkPrettierConfig, prettierInstalled } from './engines/prettier.ts'
import { listFiles } from './fs-utils.ts'
import { activeGuards } from './guards.ts'
import { makeIgnore } from './ignores.ts'
import { getPack } from './packs.ts'
import { findConfigFile, loadPolicy } from './policy.ts'
import { toolset } from './tools.ts'
import { type EngineName, type FormatterName, type Policy, type Runtime } from './types.ts'
import { NODE_RANGE, PACKAGE_NAME, PACKAGE_ROOT, PEER_RANGES, VERSION } from './version.ts'

/** One tool's installed version against the versions pawl works with. */
export interface Compatibility {
  name: string
  /** The range pawl works with: its `engines.node`, the exact Biome it pins, or a peer range. */
  wanted: string
  /** Undefined when the tool is not installed. */
  installed: string | undefined
  ok: boolean
}

interface EngineState {
  installed: boolean
  /** The config file, relative to the root. */
  config?: string
  status?: string
}

/** Everything `pawl doctor` checks, as data. `--format json` prints it as it is. */
export interface DoctorReport {
  version: string
  project: {
    summary: string
    packageManager: string | undefined
    typescript: boolean
    frameworks: string[]
    runtimes: Runtime[]
    formats: string[]
    packages: number
  }
  policy: { file: string | undefined; sources: string[]; strict: boolean; maxWarnings: number | undefined }
  linter: EngineName
  formatter: FormatterName
  engines: {
    biome?: EngineState
    oxlint?: EngineState & {
      /** Rules of the standard that are on and that nothing runs: Oxlint does not enforce them, and ESLint does not take them. */
      notEnforced: Array<{ rule: string; needs: string }>
    }
    prettier?: EngineState
    eslint?: EngineState & {
      activePacks: string[]
      availablePacks: string[]
      notEnforced: Array<{ rule: string; needs: string }>
    }
  }
  compatibility: Compatibility[]
  /** Packs the repo's files call for that are not switched on, and the command that adds them. */
  suggestedPacks: string[]
  guards: string[]
  /** Guards whose code patterns cannot run with this setup. */
  guardsImportsOnly: boolean
  baseline: { allowed: number } | { missing: 'none' | 'unreadable' }
  problems: string[]
}

const LINTER_NAMES: Record<EngineName, string> = { biome: 'Biome', oxlint: 'Oxlint', eslint: 'ESLint' }

/** Check one installed tool against the range pawl declares for it. */
const compatibility = (root: string, name: string, wanted: string | undefined): Compatibility | undefined => {
  if (!wanted) return undefined

  const installed = installedVersion(root, name, name === '@biomejs/biome' ? PACKAGE_ROOT : undefined)

  return { name, wanted, installed, ok: installed !== undefined && satisfies(installed, wanted) }
}

/** How many rule names one problem line spells out before it counts the rest. */
const NAMED = 3

/**
 * One problem for each thing that is missing, not one for each rule that waits on it: a plugin
 * that is not installed can hold back twenty rules, and twenty lines would bury the other problems.
 * The whole list stays in the report, under `engines.eslint.notEnforced`.
 */
const notEnforcedProblems = (notEnforced: readonly { rule: string; needs: string }[]): string[] =>
  groupByNeed(notEnforced).map(([needs, rules]) => `Not enforced by ESLint: ${nameRules(rules)} (install ${needs}).`)

/** The rules, each group in the order given, by what they wait on. */
const groupByNeed = (notEnforced: readonly { rule: string; needs: string }[]): [string, string[]][] => {
  const byNeed = new Map<string, string[]>()

  for (const { rule, needs } of notEnforced) byNeed.set(needs, [...(byNeed.get(needs) ?? []), rule])

  return [...byNeed]
}

/** The first few names, then a count of the rest. */
const nameRules = (rules: readonly string[]): string => {
  const rest = rules.length - NAMED

  return rest > 1 ? `${rules.slice(0, NAMED).join(', ')} and ${rest} more` : rules.join(', ')
}

/** Every rule an ESLint config switches on, by the name it has there. */
const eslintEnforces = (config: ReadonlyArray<{ rules?: Record<string, unknown> }>): Set<string> => {
  const names = new Set<string>()

  for (const { rules = {} } of config) {
    for (const [name, value] of Object.entries(rules)) {
      const level = Array.isArray(value) ? value[0] : value

      if (level !== 'off' && level !== 0) names.add(name)
    }
  }

  return names
}

/** Work out everything `pawl doctor` reports. Reads files only; runs no engine. */
/**
 * A pattern of the policy whose brackets match no path as the characters themselves, but would match
 * some as a character class, as in `legacy/v[0-9]`. Pawl reads brackets the first way, for route
 * folders such as `app/[slug]`, so such a pattern skips nothing, and nothing else says so.
 */
const bracketProblems = (root: string, policy: Policy): string[] => {
  const patterns = [
    ...policy.ignore.map(pattern => ({ pattern, where: 'ignore' })),
    ...policy.overrides.flatMap(override =>
      override.files.map(pattern => ({ pattern, where: 'the files of an override' }))
    )
  ].filter(({ pattern }) => /\\[[\]]/.test(pattern))

  if (patterns.length === 0) return []

  const files = listFiles(root)

  return patterns.flatMap(({ pattern, where }) => {
    const written = pattern.replace(/\\([[\]])/g, '$1')

    if (files.some(makeIgnore([pattern]))) return []

    const example = files.find(makeIgnore([written]))

    return example === undefined
      ? []
      : [
          `"${written}" in ${where} matches no file: pawl reads brackets as the characters themselves. As a character class it would match ${example}, so list the paths it should match instead.`
        ]
  })
}

export const doctor = async (root: string): Promise<DoctorReport> => {
  const policy = await loadPolicy(root)
  const detection = detect(root, policy)
  const tools = toolset(root, policy)
  const file = findConfigFile(root)
  const problems: string[] = []
  const engines: DoctorReport['engines'] = {}

  for (const violation of policy.lockViolations) {
    problems.push(
      `"${violation.rule}" is locked at "${violation.kept}"; ${violation.source} tried to set "${violation.wanted}".`
    )
  }

  const peers = PEER_RANGES
  const compat: Compatibility[] = []
  const push = (entry: Compatibility | undefined): void => {
    if (entry) compat.push(entry)
  }

  push({
    name: 'node',
    wanted: NODE_RANGE,
    installed: process.versions.node,
    ok: satisfies(process.versions.node, NODE_RANGE)
  })

  if (tools.biome) {
    const config = checkBiomeConfig(root, policy, biomeContextFor(root, policy, detection, tools))
    const installed = biomeInstalled(root)

    engines.biome = { installed, ...(config.file ? { config: config.file } : {}), status: config.status }

    if (installed) {
      push(compatibility(root, '@biomejs/biome', BIOME_VERSION))
    } else {
      problems.push(`Biome is not installed. Add @biomejs/biome@${BIOME_VERSION} to devDependencies.`)
    }

    if (config.issue) problems.push(`${config.issue.message} ${config.issue.fix ?? ''}`.trim())

    if (extendsPackage(config.preset) && !presetInstalled(root)) {
      problems.push(
        `${config.file} extends ${BIOME_PRESET}, but ${PACKAGE_NAME} is not installed in this project. Add it to devDependencies and install.`
      )
    }
  }

  if (tools.linter === 'oxlint') {
    const config = checkOxlintConfig(root, policy, oxlintContextFor(detection, root))
    const installed = oxlintInstalled(root)

    engines.oxlint = { installed, config: OXLINT_CONFIG_FILE, status: config.status, notEnforced: [] }

    if (installed) {
      push(compatibility(root, 'oxlint', peers.oxlint))
    } else {
      problems.push('Oxlint is not installed. Add oxlint to devDependencies.')
    }

    if (oxlintContextFor(detection, root).typeAware === true && !tsgolintInstalled(root)) {
      problems.push(
        `${TYPE_AWARE_PACKAGE} is a dependency of this project but is not installed. Install the dependencies.`
      )
    }

    if (config.issue) problems.push(`${config.issue.message} ${config.issue.fix ?? ''}`.trim())
  }

  if (tools.formatter === 'prettier') {
    const config = checkPrettierConfig(root, policy)
    const installed = prettierInstalled(root)

    engines.prettier = { installed, ...(config.file ? { config: config.file } : {}), status: config.status }

    if (installed) {
      push(compatibility(root, 'prettier', peers.prettier))
    } else {
      problems.push('Prettier is not installed. Add prettier to devDependencies.')
    }

    if (config.issue) problems.push(`${config.issue.message} ${config.issue.fix ?? ''}`.trim())
  }

  let activePacks: string[] = []
  let ruleOwners: { enforced: Set<string>; failed: Set<string> } = { enforced: new Set(), failed: new Set() }

  if (tools.eslint) {
    const installed = eslintInstalled(root)
    const plan = await eslintPlanFor(root, policy)

    activePacks = plan.activePacks
    engines.eslint = {
      installed,
      activePacks: plan.activePacks,
      availablePacks: plan.availablePacks,
      notEnforced: plan.notEnforced
    }

    if (installed) {
      push(compatibility(root, 'eslint', peers.eslint))
    } else {
      problems.push('ESLint is set up for this repo but not installed. Add eslint to devDependencies.')
    }

    // The plugin of each active pack, against the versions the pack was written for.
    for (const name of plan.activePacks) {
      const pack = getPack(name)

      if (pack && pack.plugin !== 'eslint') push(compatibility(root, pack.plugin, pack.range))
    }

    problems.push(...notEnforcedProblems(plan.notEnforced))
    ruleOwners = { enforced: eslintEnforces(plan.config), failed: new Set(plan.notEnforced.map(item => item.rule)) }
  }

  if (engines.oxlint) {
    const wanted = oxlintGaps(policy, oxlintContextFor(detection, root)).filter(
      ({ rule }) =>
        // A project without TypeScript has no file for a TypeScript rule.
        (detection.typescript || !rule.startsWith('@typescript-eslint/')) &&
        // ESLint next to Oxlint takes what Oxlint leaves; a rule it cannot load is already a problem above.
        !ruleOwners.enforced.has(rule.replace(/^eslint:/, '')) &&
        !ruleOwners.failed.has(rule)
    )

    engines.oxlint.notEnforced = wanted

    for (const [needs, rules] of groupByNeed(wanted)) {
      if (needs !== NO_OXLINT_EQUIVALENT)
        problems.push(`Not enforced by Oxlint: ${nameRules(rules)} (install ${needs}).`)
    }
  }

  for (const entry of compat) {
    if (entry.ok || entry.installed === undefined) continue

    problems.push(
      entry.name === 'node'
        ? `Node ${entry.installed} is older than pawl supports (${entry.wanted}). Upgrade Node.`
        : `${entry.name} ${entry.installed} is not a version pawl works with (${entry.wanted}). Install ${entry.name}@${entry.name === '@biomejs/biome' ? BIOME_VERSION : `"${entry.wanted}"`}.`
    )
  }

  const baseline = readBaseline(root)
  const allowed = Object.values(baseline?.findings ?? {}).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
    0
  )
  const unreadable = baselineUnreadable(root)

  if (unreadable) {
    problems.push(
      `${BASELINE_FILE} cannot be read. Resolve the merge conflict in it, or run "pawl baseline" to record the findings again.`
    )
  }

  problems.push(...bracketProblems(root, policy))

  const guards = activeGuards(detection.dependencies, policy.packs)
  const named = new Set([...policy.packs.map(entry => entry.split('/')[0] ?? entry), ...activePacks])

  return {
    version: VERSION,
    project: {
      summary: describe(detection),
      packageManager: detection.packageManager,
      typescript: detection.typescript,
      frameworks: detection.frameworks,
      runtimes: detection.runtimes,
      formats: detection.formats,
      packages: detection.workspace.packages.length
    },
    policy: {
      file: file?.slice(root.length + 1),
      sources: policy.sources,
      strict: policy.strict,
      maxWarnings: policy.maxWarnings
    },
    linter: tools.linter,
    formatter: tools.formatter,
    engines,
    compatibility: compat,
    suggestedPacks: filePacks(detection).filter(pack => !named.has(pack)),
    guards: guards.map(guard => guard.name),
    // Biome runs the code patterns as rules of pawl's own. ESLint runs them as selectors. Oxlint cannot.
    guardsImportsOnly: guards.some(guard => guard.syntax) && !tools.eslint && tools.linter !== 'biome',
    baseline: baseline ? { allowed } : { missing: unreadable ? 'unreadable' : 'none' },
    problems
  }
}

/** The report for people, one line per part, then the problems. */
export const formatDoctor = (report: DoctorReport): string => {
  const { engines } = report
  const versionOf = (name: string): string | undefined =>
    report.compatibility.find(entry => entry.name === name)?.installed
  const lines = [
    `pawl ${report.version}`,
    `Project:  ${report.project.summary}`,
    `Runtime:  ${report.project.runtimes.join(', ')}`,
    `Policy:   ${report.policy.file ? report.policy.sources.slice(1).join(' -> ') : 'default standard (no pawl.config file)'}${report.policy.strict ? ', strict' : ''}${report.policy.maxWarnings === undefined ? '' : `, at most ${report.policy.maxWarnings} warnings`}`,
    `Lint:     ${LINTER_NAMES[report.linter]}${report.linter !== 'eslint' && engines.eslint ? ', with ESLint for the packs' : ''}`,
    `Format:   ${report.formatter === 'biome' ? 'Biome' : 'Prettier'}`,
    `Node:     ${process.versions.node}`
  ]

  if (engines.biome) {
    lines.push(
      `Biome:    ${engines.biome.installed ? (versionOf('@biomejs/biome') ?? BIOME_VERSION) : 'not installed'}, ${engines.biome.config ?? 'no config'} ${engines.biome.status === 'ok' ? 'in line with the policy' : `(${engines.biome.status})`}`
    )
  }

  if (engines.oxlint) {
    lines.push(
      `Oxlint:   ${engines.oxlint.installed ? (versionOf('oxlint') ?? 'installed') : 'not installed'}, ${OXLINT_CONFIG_FILE} (${engines.oxlint.status})`
    )
  }

  if (engines.oxlint) {
    const none = engines.oxlint.notEnforced.filter(({ needs }) => needs === NO_OXLINT_EQUIVALENT)

    if (none.length > 0) {
      lines.push(`          not enforced, no Oxlint equivalent: ${nameRules(none.map(({ rule }) => rule))}`)
    }
  }

  if (engines.prettier) {
    lines.push(
      `Prettier: ${engines.prettier.installed ? (versionOf('prettier') ?? 'installed') : 'not installed'}, ${engines.prettier.config ?? 'no config'} (${engines.prettier.status})`
    )
  }

  if (engines.eslint) {
    lines.push(`ESLint:   ${engines.eslint.installed ? (versionOf('eslint') ?? 'installed') : 'not installed'}`)
    lines.push(
      `Packs:    ${engines.eslint.activePacks.length > 0 ? engines.eslint.activePacks.join(', ') : 'none active'}`
    )

    if (engines.eslint.availablePacks.length > 0) {
      lines.push(
        `          available for this project: ${engines.eslint.availablePacks.join(', ')} (pawl add ${engines.eslint.availablePacks.join(' ')})`
      )
    }
  }

  if (report.suggestedPacks.length > 0) {
    lines.push(
      `Suggest:  ${report.suggestedPacks.join(', ')} for the files in this repo (pawl add ${report.suggestedPacks.join(' ')})`
    )
  }

  if (report.guards.length > 0) {
    lines.push(
      `Guards:   ${report.guards.join(', ')}${report.guardsImportsOnly ? ' (imports only: with Oxlint as the linter, the code patterns need ESLint next to it)' : ''}`
    )
  }

  const { baseline } = report

  lines.push(
    `Baseline: ${'allowed' in baseline ? `${baseline.allowed} finding${baseline.allowed === 1 ? '' : 's'} allowed` : `none (${baseline.missing === 'unreadable' ? 'unreadable' : 'run "pawl baseline"'})`}`
  )
  lines.push(
    '',
    ...(report.problems.length > 0 ? report.problems.map(problem => `Problem: ${problem}`) : ['No problems found.'])
  )

  return lines.join('\n')
}
