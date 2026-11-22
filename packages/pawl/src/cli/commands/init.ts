/** `pawl init`: choose the tools, show the plan, write it, install, and record the first baseline. */

import { BASELINE_FILE } from '../../check/baseline.ts'
import { EXIT_OK, EXIT_SETUP } from '../../check/result.ts'
import { describe, detect } from '../../project/detect.ts'
import { describePlan, formatWritten, type InitMode, planInit, recordBaseline } from '../../setup/init.ts'
import { applyPlan } from '../../setup/plan.ts'
import { type EngineName, type FormatterName } from '../../types.ts'
import { plural } from '../../utils/text.ts'
import { type Flags, oneOf, packList } from '../args.ts'
import { endDryRun, out, printNotes, runInstall } from '../io.ts'
import { confirm, isInteractive, select } from '../prompt.ts'

const MODES: readonly InitMode[] = ['auto', 'keep', 'biome']

interface Chosen {
  mode: InitMode
  asked: boolean
  engine?: EngineName
  formatter?: FormatterName
}

/** Read the tool choices from the flags, or ask when there is a terminal and nothing was said. */
export const chooseMode = async (root: string, flags: Flags): Promise<Chosen> => {
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
  const { mode, asked, ...choice } = await chooseMode(root, flags)
  const install = flags['no-install'] !== true
  const plan = await planInit({
    root,
    mode,
    migrated,
    editor: flags['no-editor'] !== true,
    workflow: flags.workflow === true,
    agents: flags.agents === true,
    hooks: flags.hooks === true,
    install,
    packages,
    ...choice,
    ...(flags.packs ? { packs: packList(flags.packs) } : {})
  })

  out(describePlan(plan, { header: !asked }).join('\n'))

  if (plan.install) out(`Run    ${plan.install}`)

  if (flags['dry-run']) {
    endDryRun(plan.notes)

    return EXIT_OK
  }

  if (plan.actions.length > 0 && !flags.yes && !(await confirm('Apply these changes?'))) {
    out('Nothing was changed.')

    return EXIT_OK
  }

  applyPlan(plan)

  const installed = plan.install === undefined || runInstall(root, plan.install)

  out('')

  printNotes(plan.notes)

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
        `Baseline: ${plural(baselined, 'existing finding')} recorded in ${BASELINE_FILE}. New ones will fail the check.`
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
