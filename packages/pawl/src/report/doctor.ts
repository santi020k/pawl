import { activeGuards } from '../catalog/guards.ts'
import { getPack } from '../catalog/packs.ts'
import { readBaseline, unreadableBaseline } from '../check/baseline.ts'
import { BIOME_VERSION } from '../engines/biome/config.ts'
import { eslintPlanFor } from '../engines/eslint/plan.ts'
import { activeEngines } from '../engines/registry.ts'
import { findConfigFile } from '../policy/load.ts'
import { lockIssues } from '../policy/merge.ts'
import { loadProject } from '../policy/project.ts'
import { OXLINT_CONFIG_FILE } from '../project/config-files.ts'
import { describe, filePacks } from '../project/detect.ts'
import { type EngineName, type FormatterName, type Runtime, type SetupIssue } from '../types.ts'
import { installedVersion, satisfies } from '../utils/semver.ts'
import { plural } from '../utils/text.ts'
import { NODE_RANGE, PACKAGE_ROOT, VERSION } from '../version.ts'

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
    oxlint?: EngineReport
    prettier?: EngineReport
    eslint?: EngineReport & {
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

  for (const engine of activeEngines(tools)) {
    const state = engine.inspect(project)
    const installed = engine.installed(root)

    if (installed) push(compatibility(root, engine.packageName, engine.range, engine.name === 'biome'))
    else problems.push(problem(engine.missing))

    problems.push(...state.issues.map(problem))

    if (engine.name !== 'eslint') {
      engines[engine.name] = {
        installed,
        ...(state.config ? { config: state.config } : {}),
        ...(state.status ? { status: state.status } : {})
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

    for (const { rule, needs } of plan.notEnforced) problems.push(`Not enforced by ESLint: ${rule} (install ${needs}).`)
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
    `Baseline: ${'allowed' in baseline ? `${plural(baseline.allowed, 'finding')} allowed` : `none (${baseline.missing === 'unreadable' ? 'unreadable' : 'run "pawl baseline"'})`}`
  )
  lines.push(
    '',
    ...(report.problems.length > 0 ? report.problems.map(problem => `Problem: ${problem}`) : ['No problems found.'])
  )

  return lines.join('\n')
}
