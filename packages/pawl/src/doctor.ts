import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BASELINE_FILE, readBaseline } from './baseline.ts'
import { installedVersion, satisfies } from './compat.ts'
import { describe, detect, filePacks } from './detect.ts'
import { BIOME_VERSION, biomeContextFor, biomeInstalled, checkBiomeConfig } from './engines/biome.ts'
import { eslintInstalled, eslintPlanFor } from './engines/eslint.ts'
import { toolStates } from './engines/languages.ts'
import { checkOxlintConfig, OXLINT_CONFIG_FILE, oxlintContextFor, oxlintInstalled } from './engines/oxlint.ts'
import { checkPrettierConfig, prettierInstalled } from './engines/prettier.ts'
import { activeGuards } from './guards.ts'
import { LANGUAGE_INFO, type Language } from './languages.ts'
import { getPack } from './packs.ts'
import { findConfigFile, loadPolicy } from './policy.ts'
import { toolset } from './tools.ts'
import { type EngineName, type FormatterName, type Runtime } from './types.ts'
import { NODE_RANGE, PACKAGE_ROOT, PEER_RANGES, VERSION } from './version.ts'

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
    oxlint?: EngineState
    prettier?: EngineState
    eslint?: EngineState & {
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
const compatibility = (root: string, name: string, wanted: string | undefined): Compatibility | undefined => {
  if (!wanted) return undefined

  const installed = installedVersion(root, name, name === '@biomejs/biome' ? PACKAGE_ROOT : undefined)

  return { name, wanted, installed, ok: installed !== undefined && satisfies(installed, wanted) }
}

/** Work out everything `pawl doctor` reports. Reads files only; runs no engine. */
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
  }

  if (tools.linter === 'oxlint') {
    const config = checkOxlintConfig(root, policy, oxlintContextFor(detection))
    const installed = oxlintInstalled(root)

    engines.oxlint = { installed, config: OXLINT_CONFIG_FILE, status: config.status }

    if (installed) {
      push(compatibility(root, 'oxlint', peers.oxlint))
    } else {
      problems.push('Oxlint is not installed. Add oxlint to devDependencies.')
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

    for (const { rule, needs } of plan.notEnforced) problems.push(`Not enforced by ESLint: ${rule} (install ${needs}).`)
  }

  const languages: DoctorReport['languages'] = detection.languages.map(({ language, dir, manifest }) => {
    const chosen = policy.languages[language]

    return { language, dir, manifest, checked: chosen !== undefined, tools: chosen ? toolStates(language, chosen) : [] }
  })

  for (const language of new Set(languages.flatMap(entry => (entry.checked ? [entry.language] : [])))) {
    const missing = languages.find(entry => entry.language === language)?.tools.filter(tool => !tool.installed) ?? []

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
    baseline: baseline ? { allowed } : { missing: existsSync(join(root, BASELINE_FILE)) ? 'unreadable' : 'none' },
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

  for (const entry of report.languages) {
    const { title } = LANGUAGE_INFO[entry.language]
    const where = `${entry.dir || 'the root'} (${entry.manifest})`
    const missing = entry.tools.filter(tool => !tool.installed).map(tool => tool.name)
    const checked = `checked with ${entry.tools.map(tool => tool.name).join(' and ')}${missing.length > 0 ? ` (${missing.join(' and ')} not installed)` : ''}`

    lines.push(
      `${`${title}:`.padEnd(10)}${where}, ${entry.checked ? checked : `not checked (add "${entry.language}" to languages in the policy, or check it with Quality)`}`
    )
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
