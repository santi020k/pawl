/** `pawl init`: choose the tools, show the plan, write it, install, and record the first baseline. */

import { BASELINE_FILE } from '../../check/baseline.ts'
import { unparsedNote } from '../../check/output.ts'
import { EXIT_OK, EXIT_SETUP } from '../../check/result.ts'
import { describe, detect } from '../../project/detect.ts'
import {
  describePlan,
  formatWritten,
  type InitMode,
  type InitPlan,
  planInit,
  recordInitBaseline
} from '../../setup/init.ts'
import { applyPlan, type SetupAction } from '../../setup/plan.ts'
import { type EngineName, type FormatterName } from '../../types.ts'
import { plural } from '../../utils/text.ts'
import { VERSION } from '../../version.ts'
import { type Flags, oneOf, packList } from '../args.ts'
import { type Terminal, terminal } from '../audience.ts'
import { endDryRun, installQuietly, out, printNotes, runInstall, tail } from '../io.ts'
import { type Choice, confirm, isInteractive, multiselect, select } from '../prompt.ts'
import { type Rail, rail, wrap } from '../ui.ts'

const MODES: readonly InitMode[] = ['auto', 'keep', 'biome']

const ENGINE_NAMES: Record<EngineName, string> = { biome: 'Biome', oxlint: 'Oxlint', eslint: 'ESLint' }

interface Chosen {
  mode: InitMode
  asked: boolean
  engine?: EngineName
  formatter?: FormatterName
}

/** What a person can add around the tools. The flags say it outright; a person can be asked. */
interface Extras {
  editor: boolean
  agents: boolean
  hooks: boolean
  workflow: boolean
}

type Extra = keyof Extras

/** What the repo already has, said once at the top. */
const detected = (root: string): { summary: string; found: string[] } => {
  const detection = detect(root)
  const { eslint, biome, prettier, oxlint } = detection.tools
  const found = [eslint && 'ESLint', biome && 'Biome', oxlint && 'Oxlint', prettier && 'Prettier'].filter(
    (tool): tool is string => typeof tool === 'string'
  )

  return { summary: describe(detection), found }
}

/** Read the tool choices from the flags, or ask when there is a terminal and nothing was said. */
export const chooseMode = async (root: string, flags: Flags, ui?: Rail): Promise<Chosen> => {
  const engine = oneOf<EngineName>(flags.engine, ['biome', 'oxlint', 'eslint'], 'engine')
  const formatter = oneOf<FormatterName>(flags.formatter, ['biome', 'prettier'], 'formatter')
  const explicit = { ...(engine ? { engine } : {}), ...(formatter ? { formatter } : {}) }
  const mode = oneOf<InitMode>(flags.mode, MODES, 'mode')

  if (mode || engine || formatter || flags.yes || !isInteractive())
    return { mode: mode ?? 'auto', asked: false, ...explicit }

  const detection = detect(root)
  const { eslint, prettier } = detection.tools
  const { summary, found } = detected(root)

  if (ui) {
    ui.info('Detected', [summary, ...(found.length > 0 ? [`Found ${found.join(', ')}`] : [])])
  } else {
    out(`Detected: ${summary}`)
    out(found.length > 0 ? `Found:    ${found.join(', ')}\n` : '')
  }

  const autoHint = eslint
    ? `Biome lints and formats, ESLint stays${prettier ? ', Biome replaces Prettier' : ''}`
    : 'Biome lints and formats'
  const picked = await select<InitMode | 'custom'>('How should pawl set up this repo?', [
    { value: 'auto', label: 'Auto (recommended)', hint: autoHint },
    { value: 'keep', label: 'Keep what I have', hint: 'Stay on the linter and formatter this repo already uses' },
    { value: 'biome', label: 'Biome only', hint: 'Lint and format with Biome, stop running ESLint' },
    { value: 'custom', label: 'Choose my tools', hint: 'Pick the linter and the formatter yourself' }
  ])

  if (!ui) out('')

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

  if (!ui) out('')

  return { mode: 'auto', asked: true, engine: linter, formatter: format }
}

const EXTRA_CHOICES: readonly Choice<Extra>[] = [
  {
    value: 'editor',
    label: 'Editor',
    hint: 'VS Code: format on save, and tasks that put findings in the Problems panel'
  },
  { value: 'agents', label: 'Coding agents', hint: 'Hooks that fix each edit, AGENTS.md and a pawl skill' },
  { value: 'hooks', label: 'Pre-commit hook', hint: 'Check the changed files before each commit' },
  { value: 'workflow', label: 'GitHub workflow', hint: 'Run "pawl check --ci" on every pull request' }
]

/**
 * What to set up around the tools. A flag for any of them, or --yes, means the person said what
 * they want; otherwise a person at a terminal picks, starting from the editor and the agents.
 */
const chooseExtras = async (flags: Flags, asked: boolean): Promise<Extras> => {
  const given: Extras = {
    editor: flags['no-editor'] !== true,
    agents: flags.agents === true,
    hooks: flags.hooks === true,
    workflow: flags.workflow === true
  }
  const said = flags['no-editor'] === true || given.agents || given.hooks || given.workflow

  if (said || !asked) return given

  const picked = await multiselect('What else should pawl set up?', EXTRA_CHOICES, ['editor', 'agents'])

  return {
    editor: picked.includes('editor'),
    agents: picked.includes('agents'),
    hooks: picked.includes('hooks'),
    workflow: picked.includes('workflow')
  }
}

/** The plan on the rail: the tools, then a line per file with + for new and ~ for changed. */
const showPlan = (plan: InitPlan, ui: Rail, term: Terminal): void => {
  const { style } = term
  const width = Math.max(0, ...plan.actions.map(action => action.path.length))
  // A long summary goes on under itself, so the rail stays straight.
  const room = Math.max(20, term.width - width - 9)
  const line = (action: SetupAction): string[] => {
    const [first = '', ...rest] = wrap(action.summary, room)
    const mark = action.kind === 'create' ? style.accent('+') : style.yellow('~')

    return [
      `${mark} ${action.path.padEnd(width)}  ${style.dim(first)}`,
      ...rest.map(text => `  ${' '.repeat(width)}  ${style.dim(text)}`)
    ]
  }
  const linters = plan.engines.map(engine => ENGINE_NAMES[engine]).join(' + ') || 'none'

  ui.step('The plan', [
    `${style.dim('Lint  ')}  ${style.bold(linters)}`,
    `${style.dim('Format')}  ${style.bold(plan.formatter === 'biome' ? 'Biome' : 'Prettier')}`,
    '',
    ...(plan.actions.length > 0
      ? plan.actions.flatMap(line)
      : [style.dim('Nothing to change. This repo is already set up.')]),
    ...(plan.install ? ['', `${style.dim('$')} ${plan.install}`] : [])
  ])
}

/** Install with a spinner for a person, or quietly for an agent, and say what to run when it fails. */
const install = async (root: string, command: string, term: Terminal, ui?: Rail): Promise<boolean> => {
  if (!ui && !term.agent) return runInstall(root, command)

  const manager = command.split(' ')[0] ?? 'the package manager'
  const status = ui?.spinner(`Installing with ${manager}${term.sym.ellipsis}`)
  const { ok, output } = await installQuietly(root, command)

  if (ok) {
    status?.stop(`Installed with ${manager}`)

    return true
  }

  if (ui && status) {
    status.stop(`${manager} could not install`, 'error')
    ui.lines(tail(output).map(text => term.style.dim(text)))
    ui.note(`Run this yourself: ${command}`)
  } else {
    out(`${tail(output).join('\n')}\n\nCould not install automatically. Run this yourself:\n  ${command}`)
  }

  return false
}

/**
 * `migrated`: `pawl migrate` runs this right after it carried the old config into the policy.
 * `packages`: more packages to install, such as the policy package the migration extends.
 */
export const runInit = async (
  root: string,
  flags: Flags,
  migrated = false,
  packages: readonly string[] = []
): Promise<number> => {
  const term = terminal()
  const ui = term.rich ? rail(term) : undefined
  const { style } = term

  if (ui && !migrated) ui.start(`${style.accentBadge(' pawl ')} init  ${style.dim(VERSION)}`)

  const { mode, asked, ...choice } = await chooseMode(root, flags, ui)
  const extras = await chooseExtras(flags, asked)
  const plan = await planInit({
    root,
    mode,
    migrated,
    baseline: flags['no-baseline'] !== true,
    ...extras,
    install: flags['no-install'] !== true,
    packages,
    ...choice,
    ...(flags.packs ? { packs: packList(flags.packs) } : {})
  })

  if (ui) {
    if (!asked) {
      const { summary, found } = detected(root)

      ui.info('Detected', [summary, ...(found.length > 0 ? [`Found ${found.join(', ')}`] : [])])
    }

    showPlan(plan, ui, term)
  } else {
    out(describePlan(plan, { header: !asked }).join('\n'))

    if (plan.install) out(`Run    ${plan.install}`)
  }

  if (flags['dry-run']) {
    if (!ui) {
      endDryRun(plan.notes)

      return EXIT_OK
    }

    for (const note of plan.notes) ui.note(note)

    ui.end('Dry run. Nothing was changed.')

    return EXIT_OK
  }

  if (plan.actions.length > 0 && !flags.yes && !(await confirm('Apply these changes?'))) {
    if (ui) ui.end('Nothing was changed.')
    else out('Nothing was changed.')

    return EXIT_OK
  }

  applyPlan(plan)

  if (ui && plan.actions.length > 0) ui.step(`Wrote ${plural(plan.actions.length, 'file')}`)

  const installed = plan.install === undefined || (await install(root, plan.install, term, ui))

  if (!ui) out('')

  if (ui) for (const note of plan.notes) ui.note(note)
  else printNotes(plan.notes)

  if (!installed) {
    ui?.end(`Install the tools, then run ${style.bold('pawl baseline')}.`)

    return EXIT_SETUP
  }

  if (plan.engines.includes('biome') || plan.formatter === 'biome')
    await formatWritten(
      root,
      plan.actions.map(action => action.path)
    )

  // With --no-baseline there is nothing to record, and the plan's notes already said so.
  const status = plan.baseline === false ? undefined : ui?.spinner(`Recording the baseline${term.sym.ellipsis}`)

  try {
    const recorded = await recordInitBaseline(root, plan)

    if (recorded === undefined) {
      status?.stop(`Kept the baseline in ${BASELINE_FILE}`)
    } else {
      const line = `${plural(recorded.baselined, 'existing finding')} recorded in ${BASELINE_FILE}. New ones will fail the check.`
      const unparsed = unparsedNote(recorded.unparsed)

      if (status) status.stop(`Baseline: ${line}`)
      else out(`Baseline: ${line}`)

      if (unparsed.length > 0) out(unparsed.join('\n'))
    }
  } catch (error) {
    const message = `Could not record the baseline: ${(error as Error).message}`

    if (status && ui) {
      status.stop(message, 'error')
      ui.end(`Install the dependencies, then run ${style.bold('pawl baseline')}.`)
    } else {
      out(`${message}\nInstall the dependencies, then run "pawl baseline".`)
    }

    return EXIT_SETUP
  }

  if (ui) ui.end(`Done. Run ${style.bold('pawl check')} to check the code and ${style.bold('pawl fix')} to fix it.`)
  else out('\nDone. Run "pawl check" to check the code and "pawl fix" to fix it.')

  return EXIT_OK
}
