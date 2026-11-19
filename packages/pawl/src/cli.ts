#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { BASELINE_FILE, readBaseline } from './baseline.ts'
import { BLOCKING, check, EXIT_FINDINGS, EXIT_OK, EXIT_SETUP, exitCode } from './check.ts'
import { describe, detect } from './detect.ts'
import { getDockerRule } from './docker.ts'
import { BIOME_VERSION, biomeContextFor, biomeInstalled, checkBiomeConfig } from './engines/biome.ts'
import { eslintInstalled, eslintPlanFor } from './engines/eslint.ts'
import { checkOxlintConfig, OXLINT_CONFIG_FILE, oxlintContextFor, oxlintInstalled } from './engines/oxlint.ts'
import { checkPrettierConfig, prettierInstalled } from './engines/prettier.ts'
import { activeGuards } from './guards.ts'
import {
  applyInit,
  describePlan,
  formatWritten,
  type InitAction,
  type InitMode,
  planAdd,
  planBiomeConfig,
  planBiomePackages,
  planInit,
  planOxlintConfig,
  planPrettierConfig,
  planRuleFiles,
  recordBaseline
} from './init.ts'
import { describeMigration, planMigrate } from './migrate.ts'
import { format, type OutputFormat } from './output.ts'
import { effectiveRules, findConfigFile, loadPolicy } from './policy.ts'
import { confirm, isInteractive, select } from './prompt.ts'
import { defaultLevel, findRule } from './rules.ts'
import { toolset } from './tools.ts'
import { type EngineName, type FormatterName } from './types.ts'
import { VERSION } from './version.ts'

const HELP = `pawl ${VERSION}
Fast guardrails for AI-written code.

Usage
  pawl init             Set up this repo
  pawl check [files]    Lint, check formatting and apply the ratchet
  pawl fix [files]      Apply safe fixes and format
  pawl sync             Rewrite engine config files from the policy
  pawl add <pack...>    Switch on optional packs and install their ESLint plugins
  pawl migrate          Turn an existing ESLint config into a pawl policy, then set up
  pawl baseline         Accept the current findings as the baseline
  pawl explain <rule>   Show what a rule does and its level here
  pawl doctor           Check the setup

Options for check and fix
  --changed             Only files changed against HEAD, plus untracked ones
  --format <kind>       pretty (default), agent or json
  --ci                  Also fail when the setup has drifted from the policy
  --verbose             Show the engine commands that ran

Options for init
  --mode <mode>         auto (default), keep or biome
  --engine <name>       The linter: biome, oxlint or eslint
  --formatter <name>    The formatter: biome or prettier
  --packs <a,b>         Optional packs to switch on
  --yes                 Accept the plan without asking
  --dry-run             Show the plan and change nothing
  --workflow            Add a GitHub Actions workflow
  --agents              Add hooks for Claude Code and Cursor, and instructions in AGENTS.md
  --hooks               Add a pre-commit hook that checks changed files
  --no-editor           Skip editor settings
  --no-install          Do not run the package manager

Options for migrate (it also takes the options for init)
  --keep-config         Write the policy and leave the ESLint config file alone

  -h, --help            Show this help
  -v, --version         Show the version
`

const OPTIONS = {
  changed: { type: 'boolean' },
  format: { type: 'string' },
  ci: { type: 'boolean' },
  verbose: { type: 'boolean' },
  mode: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  'dry-run': { type: 'boolean' },
  workflow: { type: 'boolean' },
  agents: { type: 'boolean' },
  hooks: { type: 'boolean' },
  engine: { type: 'string' },
  formatter: { type: 'string' },
  packs: { type: 'string' },
  'no-editor': { type: 'boolean' },
  'no-install': { type: 'boolean' },
  'keep-config': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' }
} as const

type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values']

const out = (text: string): void => {
  if (text.length > 0) process.stdout.write(`${text}\n`)
}

const colorEnabled = (): boolean => process.stdout.isTTY === true && process.env.NO_COLOR === undefined

class UsageError extends Error {}

const outputFormat = (flags: Flags): OutputFormat => {
  const kind = flags.format ?? 'pretty'

  if (kind !== 'pretty' && kind !== 'agent' && kind !== 'json')
    throw new UsageError(`Unknown format "${kind}". Use pretty, agent or json.`)

  return kind
}

const runCheck = async (root: string, files: string[], flags: Flags, fix: boolean): Promise<number> => {
  const ci = flags.ci === true || process.env.CI === 'true'
  const result = await check({ root, fix, changed: flags.changed === true, ...(files.length > 0 ? { files } : {}) })

  out(format(result, outputFormat(flags), { color: colorEnabled(), verbose: flags.verbose === true }))

  return exitCode(result, ci)
}

const MODES: readonly InitMode[] = ['auto', 'keep', 'biome']

interface Chosen {
  mode: InitMode
  asked: boolean
  engine?: EngineName
  formatter?: FormatterName
}

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined => {
  if (value === undefined) return undefined

  if (!allowed.includes(value as T)) throw new UsageError(`Unknown ${flag} "${value}". Use ${allowed.join(' or ')}.`)

  return value as T
}

/** Read the tool choices from the flags, or ask when there is a terminal and nothing was said. */
const chooseMode = async (root: string, flags: Flags): Promise<Chosen> => {
  const engine = oneOf<EngineName>(flags.engine, ['biome', 'oxlint', 'eslint'], 'engine')
  const formatter = oneOf<FormatterName>(flags.formatter, ['biome', 'prettier'], 'formatter')
  const explicit = { ...(engine ? { engine } : {}), ...(formatter ? { formatter } : {}) }
  const mode = oneOf<InitMode>(flags.mode, MODES, 'mode')

  if (mode || engine || formatter || flags.yes || !isInteractive())
    return { mode: mode ?? 'auto', asked: false, ...explicit }

  const detection = detect(root)
  const { eslint, biome, prettier, oxlint } = detection.tools
  const found = [eslint && 'ESLint', biome && 'Biome', oxlint && 'Oxlint', prettier && 'Prettier'].filter(Boolean)

  out(`Detected: ${describe(detection)}`)
  out(found.length > 0 ? `Found:    ${found.join(', ')}\n` : '')

  const autoHint = eslint
    ? `Biome lints and formats, ESLint stays${prettier ? ', Biome replaces Prettier' : ''}`
    : 'Biome lints and formats'
  const picked = await select<InitMode | 'custom'>('How should pawl set up this repo?', [
    { value: 'auto', label: 'Auto (recommended)', hint: autoHint },
    { value: 'keep', label: 'Keep what I have', hint: 'Stay on the linter and formatter this repo already uses' },
    { value: 'biome', label: 'Biome only', hint: 'Lint and format with Biome, stop running ESLint' },
    { value: 'custom', label: 'Choose my tools', hint: 'Pick the linter and the formatter yourself' }
  ])

  out('')

  if (picked !== 'custom') return { mode: picked, asked: true }

  const linter = await select<EngineName>('Which linter?', [
    { value: 'biome', label: 'Biome', hint: 'Fast, no plugins needed' },
    { value: 'oxlint', label: 'Oxlint', hint: 'Fast, uses ESLint rule names' },
    { value: 'eslint', label: 'ESLint', hint: 'Slower, runs every plugin' }
  ])
  const format = await select<FormatterName>('Which formatter?', [
    { value: 'biome', label: 'Biome', hint: 'Fast, one tool with the linter' },
    { value: 'prettier', label: 'Prettier', hint: 'The formatter many repos already use' }
  ])

  out('')

  return { mode: 'auto', asked: true, engine: linter, formatter: format }
}

const runInit = async (root: string, flags: Flags): Promise<number> => {
  const { mode, asked, ...choice } = await chooseMode(root, flags)
  const install = flags['no-install'] !== true
  const plan = await planInit({
    root,
    mode,
    editor: flags['no-editor'] !== true,
    workflow: flags.workflow === true,
    agents: flags.agents === true,
    hooks: flags.hooks === true,
    install,
    ...choice,
    ...(flags.packs
      ? {
          packs: flags.packs
            .split(',')
            .map(name => name.trim())
            .filter(Boolean)
        }
      : {})
  })

  out(describePlan(plan, { header: !asked }).join('\n'))

  if (plan.install) out(`Run    ${plan.install}`)

  if (flags['dry-run']) {
    out(['', ...plan.notes.map(note => `Note: ${note}`), '', 'Dry run. Nothing was changed.'].join('\n'))

    return EXIT_OK
  }

  if (plan.actions.length > 0 && !flags.yes && !(await confirm('Apply these changes?'))) {
    out('Nothing was changed.')

    return EXIT_OK
  }

  applyInit(plan)

  const installed = plan.install === undefined || runInstall(root, plan.install)

  out('')

  for (const note of plan.notes) out(`Note: ${note}`)

  if (!installed) return EXIT_SETUP

  if (plan.engines.includes('biome') || plan.formatter === 'biome')
    await formatWritten(
      root,
      plan.actions.map(action => action.path)
    )

  try {
    const baselined = await recordBaseline(root, plan)

    if (baselined !== undefined) {
      out(
        `Baseline: ${baselined} existing finding${baselined === 1 ? '' : 's'} recorded in ${BASELINE_FILE}. New ones will fail the check.`
      )
    }
  } catch (error) {
    out(
      `Could not record the baseline: ${(error as Error).message}\nInstall the dependencies, then run "pawl baseline".`
    )

    return EXIT_SETUP
  }

  out('\nDone. Run "pawl check" to check the code and "pawl fix" to fix it.')

  return EXIT_OK
}

const runSync = async (root: string): Promise<number> => {
  const policy = await loadPolicy(root)
  const tools = toolset(root, policy)
  const detection = detect(root, policy)
  const notes: string[] = []
  const actions: InitAction[] = []

  if (tools.biome) {
    const context = biomeContextFor(root, policy, detection, tools)
    const rootAction = planBiomeConfig(root, policy, context, notes)

    if (rootAction) actions.push(rootAction)

    actions.push(...planBiomePackages(root, detection, notes, checkBiomeConfig(root, policy, context).preset))
    actions.push(...planRuleFiles(root, policy, context, detection))
  }

  if (tools.linter === 'oxlint') {
    const oxlintAction = planOxlintConfig(root, policy, detection)

    if (oxlintAction) actions.push(oxlintAction)
  }

  if (tools.formatter === 'prettier') {
    const prettierAction = planPrettierConfig(root, policy, notes, true)

    if (prettierAction) actions.push(prettierAction)
  }

  for (const action of actions) {
    action.apply()
    out(`${action.kind === 'create' ? 'Wrote' : 'Updated'} ${action.path}`)
  }

  if (tools.biome) {
    await formatWritten(
      root,
      actions.map(action => action.path)
    )
  }

  if (actions.length === 0 && notes.length === 0) {
    out(
      tools.biome || tools.formatter === 'prettier'
        ? 'Config files are up to date.'
        : 'ESLint reads the policy live, so there is nothing to sync.'
    )
  }

  for (const note of notes) out(`Note: ${note}`)

  return EXIT_OK
}

const runMigrate = async (root: string, flags: Flags): Promise<number> => {
  const plan = await planMigrate({ root, keepConfig: flags['keep-config'] === true })

  out(describeMigration(plan).join('\n'))

  if (flags['dry-run']) {
    out(['', ...plan.notes.map(note => `Note: ${note}`), '', 'Dry run. Nothing was changed.'].join('\n'))

    return EXIT_OK
  }

  if (!flags.yes && !(await confirm('Write the policy?'))) {
    out('Nothing was changed.')

    return EXIT_OK
  }

  applyInit(plan)
  out('')

  for (const note of plan.notes) out(`Note: ${note}`)

  out('\nThe policy is written. Setting up the tools next.\n')

  // The packs the old config relied on come along, so their plugins are installed where they are missing.
  const packs = [...new Set([...(flags.packs?.split(',') ?? []), ...plan.packs])].join(',')

  return runInit(root, packs.length > 0 ? { ...flags, packs } : flags)
}

const runAdd = async (root: string, names: string[], flags: Flags): Promise<number> => {
  const plan = await planAdd(root, names, flags['no-install'] !== true)

  for (const action of plan.actions)
    out(`${action.kind === 'create' ? 'Write ' : 'Update'} ${action.path}  (${action.summary})`)

  if (plan.install) out(`Run    ${plan.install}`)

  if (flags['dry-run']) {
    out(['', ...plan.notes.map(note => `Note: ${note}`), '', 'Dry run. Nothing was changed.'].join('\n'))

    return EXIT_OK
  }

  applyInit(plan)

  const installed = plan.install === undefined || runInstall(root, plan.install)

  for (const note of plan.notes) out(`Note: ${note}`)

  if (!installed) return EXIT_SETUP

  out(`\nAdded: ${names.join(', ')}. Run "pawl doctor" to see which packs are active.`)

  return EXIT_OK
}

/** Run the package manager. Returns false, with the command to run by hand, when it fails. */
const runInstall = (root: string, command: string): boolean => {
  const [program, ...args] = command.split(' ') as [string, ...string[]]
  const ok = spawnSync(program, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0

  if (!ok) out(`\nCould not install automatically. Run this yourself:\n  ${command}`)

  return ok
}

const runBaseline = async (root: string): Promise<number> => {
  const result = await check({ root, updateBaseline: true })

  if (result.setup.some(issue => BLOCKING.includes(issue.code))) {
    out(format(result, 'pretty', { color: colorEnabled() }))

    return EXIT_SETUP
  }

  out(`Baseline updated: ${result.baselined} finding${result.baselined === 1 ? '' : 's'} recorded in ${BASELINE_FILE}.`)

  return EXIT_OK
}

const runExplain = async (root: string, query: string | undefined): Promise<number> => {
  if (!query) throw new UsageError('Which rule? For example: pawl explain no-console')

  const def = findRule(query)
  const docker = getDockerRule(query) ?? getDockerRule(`pawl/${query}`)

  if (!def && docker) {
    const level = (await loadPolicy(root)).rules[docker.name] ?? docker.level

    out(
      [
        docker.name,
        `  ${docker.summary}`,
        '',
        `  Level here:  ${level}${level === docker.level ? '' : `; the standard has ${docker.level}`}`,
        '  Checked by:  pawl, in Dockerfiles and Compose files',
        '',
        `  How to fix:  ${docker.advice}`
      ].join('\n')
    )

    return EXIT_OK
  }

  if (!def) {
    out(`"${query}" is not in the pawl catalog. If it is an engine rule, see that engine's documentation.`)

    return EXIT_FINDINGS
  }

  const policy = await loadPolicy(root)
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
    lines.push(
      `  Biome:       ${def.biome ? `${def.biome}  https://biomejs.dev/linter/rules/${kebab(def.biome.split('/')[1] ?? '')}` : 'no equivalent'}`
    )
    lines.push(`  ESLint:      ${def.name}`)
  }

  if (def.guardrail) lines.push('  Guardrail:   yes, guards against a common mistake of coding agents')

  if (def.advice) lines.push('', `  How to fix:  ${def.advice}`)

  out(lines.join('\n'))

  return EXIT_OK
}

const kebab = (name: string): string => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

const LINTER_NAMES: Record<EngineName, string> = { biome: 'Biome', oxlint: 'Oxlint', eslint: 'ESLint' }

const runDoctor = async (root: string): Promise<number> => {
  const policy = await loadPolicy(root)
  const detection = detect(root, policy)
  const tools = toolset(root, policy)
  const source = findConfigFile(root) ? policy.sources.slice(1).join(' -> ') : 'default standard (no pawl.config file)'
  const lines = [
    `pawl ${VERSION}`,
    `Project:  ${describe(detection)}`,
    `Policy:   ${source}${policy.strict ? ', strict' : ''}`,
    `Lint:     ${LINTER_NAMES[tools.linter]}${tools.linter !== 'eslint' && tools.eslint ? ', with ESLint for the packs' : ''}`,
    `Format:   ${tools.formatter === 'biome' ? 'Biome' : 'Prettier'}`
  ]
  const problems: string[] = []

  for (const violation of policy.lockViolations) {
    problems.push(
      `"${violation.rule}" is locked at "${violation.kept}"; ${violation.source} tried to set "${violation.wanted}".`
    )
  }

  if (tools.biome) {
    const config = checkBiomeConfig(root, policy, biomeContextFor(root, policy, detection, tools))

    lines.push(
      `Biome:    ${biomeInstalled(root) ? BIOME_VERSION : 'not installed'}, ${config.file ?? 'no config'} ${config.status === 'ok' ? 'in line with the policy' : `(${config.status})`}`
    )

    if (!biomeInstalled(root))
      problems.push(`Biome is not installed. Add @biomejs/biome@${BIOME_VERSION} to devDependencies.`)

    if (config.issue) problems.push(`${config.issue.message} ${config.issue.fix ?? ''}`.trim())
  }

  if (tools.linter === 'oxlint') {
    const config = checkOxlintConfig(root, policy, oxlintContextFor(detection))

    lines.push(
      `Oxlint:   ${oxlintInstalled(root) ? 'installed' : 'not installed'}, ${OXLINT_CONFIG_FILE} (${config.status})`
    )

    if (!oxlintInstalled(root)) problems.push('Oxlint is not installed. Add oxlint to devDependencies.')

    if (config.issue) problems.push(`${config.issue.message} ${config.issue.fix ?? ''}`.trim())
  }

  if (tools.formatter === 'prettier') {
    const config = checkPrettierConfig(root, policy)

    lines.push(
      `Prettier: ${prettierInstalled(root) ? 'installed' : 'not installed'}, ${config.file ?? 'no config'} (${config.status})`
    )

    if (!prettierInstalled(root)) problems.push('Prettier is not installed. Add prettier to devDependencies.')

    if (config.issue) problems.push(`${config.issue.message} ${config.issue.fix ?? ''}`.trim())
  }

  if (tools.eslint) {
    const installed = eslintInstalled(root)
    const plan = await eslintPlanFor(root, policy)

    lines.push(`ESLint:   ${installed ? 'installed' : 'not installed'}`)
    lines.push(`Packs:    ${plan.activePacks.length > 0 ? plan.activePacks.join(', ') : 'none active'}`)

    if (plan.availablePacks.length > 0) {
      lines.push(
        `          available for this project: ${plan.availablePacks.join(', ')} (pawl add ${plan.availablePacks.join(' ')})`
      )
    }

    if (!installed) problems.push('ESLint is set up for this repo but not installed. Add eslint to devDependencies.')

    for (const { rule, needs } of plan.notEnforced) problems.push(`Not enforced by ESLint: ${rule} (install ${needs}).`)
  }

  const baseline = readBaseline(root)
  const allowed = Object.values(baseline?.findings ?? {}).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
    0
  )
  const missing = existsSync(join(root, BASELINE_FILE)) ? 'unreadable' : 'run "pawl baseline"'

  const guards = activeGuards(detection.dependencies, policy.packs)

  if (guards.length > 0) {
    // Biome runs the code patterns as rules of pawl's own. ESLint runs them as selectors. Oxlint cannot.
    const needEslint = guards.some(guard => guard.syntax) && !tools.eslint && tools.linter !== 'biome'

    lines.push(
      `Guards:   ${guards.map(guard => guard.name).join(', ')}${needEslint ? ' (imports only: with Oxlint as the linter, the code patterns need ESLint next to it)' : ''}`
    )
  }

  lines.push(`Baseline: ${baseline ? `${allowed} finding${allowed === 1 ? '' : 's'} allowed` : `none (${missing})`}`)
  lines.push('', ...(problems.length > 0 ? problems.map(problem => `Problem: ${problem}`) : ['No problems found.']))
  out(lines.join('\n'))

  return problems.length > 0 ? EXIT_SETUP : EXIT_OK
}

const main = async (): Promise<number> => {
  const { values: flags, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true })
  const [command, ...rest] = positionals
  const root = process.cwd()

  if (flags.version) {
    out(VERSION)

    return EXIT_OK
  }

  if (flags.help || command === undefined || command === 'help') {
    out(HELP)

    return EXIT_OK
  }

  switch (command) {
    case 'init':
      return runInit(root, flags)
    case 'check':
      return runCheck(root, rest, flags, false)
    case 'fix':
      return runCheck(root, rest, flags, true)
    case 'sync':
      return runSync(root)
    case 'add':
      return runAdd(root, rest, flags)
    case 'migrate':
      return runMigrate(root, flags)
    case 'baseline':
      return runBaseline(root)
    case 'explain':
      return runExplain(root, rest[0])
    case 'doctor':
      return runDoctor(root)
    default:
      throw new UsageError(`Unknown command "${command}". Run "pawl --help".`)
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)

  process.stderr.write(`pawl: ${message}\n`)
  process.exitCode = EXIT_SETUP
}
