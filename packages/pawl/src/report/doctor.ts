import { activeGuards } from '../catalog/guards.ts'
import { getPack } from '../catalog/packs.ts'
import { readBaseline, unreadableBaseline } from '../check/baseline.ts'
import { BIOME_PRESET, BIOME_VERSION } from '../engines/biome/config.ts'
import { eslintPlanFor } from '../engines/eslint/plan.ts'
import { toolStates } from '../engines/languages/check.ts'
import {
  NO_OXLINT_EQUIVALENT,
  oxlintContextFor,
  oxlintGaps,
  rootDeclaresTsgolint,
  TYPE_AWARE_PACKAGE,
  tsgolintInstalled
} from '../engines/oxlint/config.ts'
import { activeEngines } from '../engines/registry.ts'
import { findConfigFile } from '../policy/load.ts'
import { lockIssues } from '../policy/merge.ts'
import { loadProject } from '../policy/project.ts'
import { OXLINT_CONFIG_FILE } from '../project/config-files.ts'
import { describe, filePacks } from '../project/detect.ts'
import { listFiles } from '../project/files.ts'
import { makeIgnore } from '../project/ignores.ts'
import { LANGUAGE_INFO, type Language } from '../project/languages.ts'
import { type EngineName, type FormatterName, type Policy, type Runtime, type SetupIssue } from '../types.ts'
import { installedVersion, satisfies } from '../utils/semver.ts'
import { plural } from '../utils/text.ts'
import { NODE_RANGE, PACKAGE_NAME, PACKAGE_ROOT, PEER_RANGES, VERSION } from '../version.ts'

/** One tool's installed version against the versions pawl works with. */
export interface Compatibility {
  name: string
  /** The range pawl works with: its `engines.node`, the exact Biome it pins, or a peer range. */
  wanted: string
  /** Undefined when the tool is not installed. */
  installed: string | undefined
  ok: boolean
}

interface EngineReport {
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
    biome?: EngineReport
    oxlint?: EngineReport & {
      /** Rules of the standard that are on and that nothing runs: Oxlint does not enforce them, and ESLint does not take them. */
      notEnforced: Array<{ rule: string; needs: string }>
    }
    prettier?: EngineReport
    eslint?: EngineReport & {
      activePacks: string[]
      availablePacks: string[]
      notEnforced: Array<{ rule: string; needs: string }>
    }
  }
  compatibility: Compatibility[]
  /** Projects in other languages, and whether pawl checks them. */
  languages: {
    language: Language
    /** The folder, relative to the root. Empty for the root itself. */
    dir: string
    manifest: string
    /** True when the policy names the language, so `pawl check` runs its tools. */
    checked: boolean
    /** The tools that run for it, and whether each is on the PATH. Empty when it is not checked. */
    tools: Array<{ name: string; installed: boolean }>
  }[]
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
const compatibility = (
  root: string,
  name: string,
  wanted: string | undefined,
  besidePawl = false
): Compatibility | undefined => {
  if (!wanted) return undefined

  const installed = installedVersion(root, name, besidePawl ? PACKAGE_ROOT : undefined)

  return { name, wanted, installed, ok: installed !== undefined && satisfies(installed, wanted) }
}

/** A setup problem as one line of the report. */
const problem = (issue: SetupIssue): string => `${issue.message} ${issue.fix ?? ''}`.trim()

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

/**
 * A pattern of the policy whose brackets match no path as the characters themselves, but would match
 * some as a character class, as in `legacy/v[0-9]`. Pawl reads brackets the first way, for route
 * folders such as `app/[slug]`, so such a pattern skips nothing, and nothing else says so.
 */
const globProblems = (root: string, policy: Policy): string[] => {
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

/** The two setup problems the doctor words as a step to take, where the check says what could not run. */
const doctorWording = (issue: SetupIssue, config: string | undefined): string | undefined => {
  if (issue.code === 'pawl-missing') {
    return `${config} extends ${BIOME_PRESET}, but ${PACKAGE_NAME} is not installed in this project. Add it to devDependencies and install.`
  }

  if (issue.code === 'tsgolint-missing') {
    return `${TYPE_AWARE_PACKAGE} is a dependency of this project but is not installed. Install the dependencies.`
  }

  return undefined
}

/** Work out everything `pawl doctor` reports. Reads files only; runs no engine. */
export const doctor = async (root: string): Promise<DoctorReport> => {
  const project = await loadProject(root)
  const { policy, detection, tools } = project
  const file = findConfigFile(root)
  const problems = lockIssues(policy).map(problem)
  const engines: DoctorReport['engines'] = {}
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

  let activePacks: string[] = []
  let ruleOwners: { enforced: Set<string>; failed: Set<string> } = { enforced: new Set(), failed: new Set() }

  for (const engine of activeEngines(tools)) {
    const state = engine.inspect(project)
    const installed = engine.installed(root)

    if (installed) push(compatibility(root, engine.packageName, engine.range, engine.name === 'biome'))
    else problems.push(problem(engine.missing))

    problems.push(...state.issues.map(issue => doctorWording(issue, state.config) ?? problem(issue)))

    if (engine.name !== 'eslint') {
      const report = {
        installed,
        ...(state.config ? { config: state.config } : {}),
        ...(state.status ? { status: state.status } : {})
      }

      if (engine.name === 'oxlint') {
        engines.oxlint = { ...report, notEnforced: [] }

        if (tsgolintInstalled(root)) push(compatibility(root, TYPE_AWARE_PACKAGE, PEER_RANGES[TYPE_AWARE_PACKAGE]))
      } else {
        engines[engine.name] = report
      }

      continue
    }

    const plan = await eslintPlanFor(root, policy)

    activePacks = plan.activePacks
    engines.eslint = {
      installed,
      activePacks: plan.activePacks,
      availablePacks: plan.availablePacks,
      notEnforced: plan.notEnforced
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

    // A workspace package's copy, or an optional peer, is one Oxlint at the root cannot run.
    const elsewhere = detection.dependencies.includes(TYPE_AWARE_PACKAGE) && !rootDeclaresTsgolint(root)

    for (const [needs, rules] of groupByNeed(wanted)) {
      if (needs === NO_OXLINT_EQUIVALENT) continue

      const add =
        needs === TYPE_AWARE_PACKAGE && elsewhere
          ? `add ${needs} to the devDependencies of the root package.json`
          : `install ${needs}`

      problems.push(`Not enforced by Oxlint: ${nameRules(rules)} (${add}).`)
    }
  }

  const languages: DoctorReport['languages'] = detection.languages.map(({ language, dir, manifest }) => {
    const chosen = policy.languages[language]

    return {
      language,
      dir,
      manifest,
      checked: chosen !== undefined,
      tools: chosen ? toolStates(language, chosen, { root, dir }) : []
    }
  })

  for (const language of new Set(languages.flatMap(entry => (entry.checked ? [entry.language] : [])))) {
    // Two Swift projects can use different formatters, so every project of the language is asked.
    const missing = [
      ...new Map(
        languages
          .filter(entry => entry.language === language)
          .flatMap(entry => entry.tools.filter(tool => !tool.installed))
          .map(tool => [tool.name, tool])
      ).values()
    ]

    if (missing.length > 0) {
      problems.push(
        `${LANGUAGE_INFO[language].title} is in the policy, but ${missing.map(tool => tool.name).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not installed. ${LANGUAGE_INFO[language].install}`
      )
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
  const unreadable = unreadableBaseline(root)

  if (unreadable) problems.push(problem(unreadable))

  problems.push(...globProblems(root, policy))

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
    languages,
    suggestedPacks: filePacks(detection).filter(pack => !named.has(pack)),
    guards: guards.map(guard => guard.name),
    // Biome runs the code patterns as rules of pawl's own. ESLint runs them as selectors. Oxlint cannot.
    guardsImportsOnly: guards.some(guard => guard.syntax) && !tools.eslint && tools.linter !== 'biome',
    baseline: baseline ? { allowed } : { missing: unreadable ? 'unreadable' : 'none' },
    problems
  }
}

/** How a line of the doctor's report stands: fine, worth a look, broken, or just so. */
export type DoctorState = 'ok' | 'warn' | 'error' | 'info'

/** One line of the doctor's report. A row with no label goes on with the row above it. */
export interface DoctorRow {
  /** The part of the report: the project and the policy, the tools, or what the ratchet and the guards do. */
  group: 'project' | 'tools' | 'extras'
  label: string
  value: string
  state: DoctorState
}

/** The rows of the report, in the order they print. */
export const doctorRows = (report: DoctorReport): DoctorRow[] => {
  const { engines } = report
  const compat = (name: string): Compatibility | undefined => report.compatibility.find(entry => entry.name === name)
  const versionOf = (name: string): string | undefined => compat(name)?.installed
  const fits = (name: string): DoctorState => (compat(name)?.ok === false ? 'warn' : 'ok')
  const engineState = (engine: { installed: boolean; status?: string }, name: string): DoctorState => {
    if (!engine.installed) return 'error'

    return engine.status !== undefined && engine.status !== 'ok' ? 'warn' : fits(name)
  }
  const rows: DoctorRow[] = []
  const add = (group: DoctorRow['group'], label: string, value: string, state: DoctorState = 'info'): void => {
    rows.push({ group, label, value, state })
  }

  add('project', 'Project', report.project.summary)
  add('project', 'Runtime', report.project.runtimes.join(', '))
  add(
    'project',
    'Policy',
    `${report.policy.file ? report.policy.sources.slice(1).join(' -> ') : 'default standard (no pawl.config file)'}${report.policy.strict ? ', strict' : ''}${report.policy.maxWarnings === undefined ? '' : `, at most ${report.policy.maxWarnings} warnings`}`
  )
  add(
    'tools',
    'Lint',
    `${LINTER_NAMES[report.linter]}${report.linter !== 'eslint' && engines.eslint ? ', with ESLint for the packs' : ''}`
  )
  add('tools', 'Format', report.formatter === 'biome' ? 'Biome' : 'Prettier')
  add('project', 'Node', process.versions.node, fits('node'))

  if (engines.biome) {
    add(
      'tools',
      'Biome',
      `${engines.biome.installed ? (versionOf('@biomejs/biome') ?? BIOME_VERSION) : 'not installed'}, ${engines.biome.config ?? 'no config'} ${engines.biome.status === 'ok' ? 'in line with the policy' : `(${engines.biome.status})`}`,
      engineState(engines.biome, '@biomejs/biome')
    )
  }

  if (engines.oxlint) {
    add(
      'tools',
      'Oxlint',
      `${engines.oxlint.installed ? (versionOf('oxlint') ?? 'installed') : 'not installed'}, ${OXLINT_CONFIG_FILE} (${engines.oxlint.status})`,
      engineState(engines.oxlint, 'oxlint')
    )

    const none = engines.oxlint.notEnforced.filter(({ needs }) => needs === NO_OXLINT_EQUIVALENT)

    if (none.length > 0) {
      add('tools', '', `not enforced, no Oxlint equivalent: ${nameRules(none.map(({ rule }) => rule))}`)
    }
  }

  if (engines.prettier) {
    add(
      'tools',
      'Prettier',
      `${engines.prettier.installed ? (versionOf('prettier') ?? 'installed') : 'not installed'}, ${engines.prettier.config ?? 'no config'} (${engines.prettier.status})`,
      engineState(engines.prettier, 'prettier')
    )
  }

  if (engines.eslint) {
    add(
      'tools',
      'ESLint',
      engines.eslint.installed ? (versionOf('eslint') ?? 'installed') : 'not installed',
      engines.eslint.installed ? fits('eslint') : 'error'
    )
    add('tools', 'Packs', engines.eslint.activePacks.length > 0 ? engines.eslint.activePacks.join(', ') : 'none active')

    if (engines.eslint.availablePacks.length > 0) {
      add(
        'tools',
        '',
        `available for this project: ${engines.eslint.availablePacks.join(', ')} (pawl add ${engines.eslint.availablePacks.join(' ')})`
      )
    }
  }

  const languageState = (checked: boolean, missing: readonly string[]): DoctorState => {
    if (!checked) return 'info'

    return missing.length > 0 ? 'error' : 'ok'
  }

  for (const entry of report.languages) {
    const { title } = LANGUAGE_INFO[entry.language]
    const where = `${entry.dir || 'the root'} (${entry.manifest})`
    const missing = entry.tools.filter(tool => !tool.installed).map(tool => tool.name)
    const checked = `checked with ${entry.tools.map(tool => tool.name).join(' and ')}${missing.length > 0 ? ` (${missing.join(' and ')} not installed)` : ''}`

    add(
      'tools',
      title,
      `${where}, ${entry.checked ? checked : `not checked (add "${entry.language}" to languages in the policy, or check it with Quality)`}`,
      languageState(entry.checked, missing)
    )
  }

  if (report.suggestedPacks.length > 0) {
    add(
      'extras',
      'Suggest',
      `${report.suggestedPacks.join(', ')} for the files in this repo (pawl add ${report.suggestedPacks.join(' ')})`
    )
  }

  if (report.guards.length > 0) {
    add(
      'extras',
      'Guards',
      `${report.guards.join(', ')}${report.guardsImportsOnly ? ' (imports only: with Oxlint as the linter, the code patterns need ESLint next to it)' : ''}`,
      report.guardsImportsOnly ? 'warn' : 'ok'
    )
  }

  const { baseline } = report
  const baselineState = (): DoctorState => {
    if ('allowed' in baseline) return 'ok'

    return baseline.missing === 'unreadable' ? 'error' : 'info'
  }

  add(
    'extras',
    'Baseline',
    'allowed' in baseline
      ? `${plural(baseline.allowed, 'finding')} allowed`
      : `none (${baseline.missing === 'unreadable' ? 'unreadable' : 'run "pawl baseline"'})`,
    baselineState()
  )

  return rows
}

/** The report for people, one line per part, then the problems. */
export const formatDoctor = (report: DoctorReport): string => {
  const lines = [
    `pawl ${report.version}`,
    ...doctorRows(report).map(row =>
      row.label ? `${`${row.label}:`.padEnd(10)}${row.value}` : `${' '.repeat(10)}${row.value}`
    )
  ]

  lines.push(
    '',
    ...(report.problems.length > 0 ? report.problems.map(problem => `Problem: ${problem}`) : ['No problems found.'])
  )

  return lines.join('\n')
}
