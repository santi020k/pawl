/** `pawl add`: switch packs on and install their ESLint plugins. */

import { EXIT_OK, EXIT_SETUP } from '../../check/result.ts'
import { planAdd } from '../../setup/add.ts'
import { applyPlan, describeActions } from '../../setup/plan.ts'
import { type Flags } from '../args.ts'
import { terminal } from '../audience.ts'
import { endDryRun, installQuietly, out, printNotes, runInstall, tail } from '../io.ts'
import { spinner } from '../ui.ts'

export const runAdd = async (root: string, names: string[], flags: Flags): Promise<number> => {
  const plan = await planAdd(root, names, flags['no-install'] !== true)
  const term = terminal()
  const { rich, style, sym } = term

  if (rich) {
    for (const action of plan.actions) {
      out(
        `${action.kind === 'create' ? style.accent('+') : style.yellow('~')} ${action.path}  ${style.dim(action.summary)}`
      )
    }

    if (plan.install) out(`${style.dim('$')} ${plan.install}`)
  } else {
    for (const line of describeActions(plan.actions)) out(line)

    if (plan.install) out(`Run    ${plan.install}`)
  }

  if (flags['dry-run']) {
    if (rich) {
      for (const note of plan.notes) out(`${style.cyan(sym.info)} ${note}`)

      out(style.dim('Dry run. Nothing was changed.'))
    } else {
      endDryRun(plan.notes)
    }

    return EXIT_OK
  }

  applyPlan(plan)

  let installed = true

  if (plan.install !== undefined) {
    if (rich || term.agent) {
      const manager = plan.install.split(' ')[0] ?? 'the package manager'
      const status = rich ? spinner(term, process.stdout, `Installing with ${manager}${sym.ellipsis}`) : undefined
      const result = await installQuietly(root, plan.install)

      installed = result.ok

      if (result.ok) status?.stop(`Installed with ${manager}`)
      else {
        status?.stop(`${manager} could not install`, 'error')
        out(
          `${tail(result.output).join('\n')}\n\nCould not install automatically. Run this yourself:\n  ${plan.install}`
        )
      }
    } else {
      installed = runInstall(root, plan.install)
    }
  }

  if (rich) for (const note of plan.notes) out(`${style.cyan(sym.info)} ${note}`)
  else printNotes(plan.notes)

  if (!installed) return EXIT_SETUP

  const added = `Added: ${names.join(', ')}.`

  out(
    rich
      ? `${style.accent(sym.tick)} ${added} Run ${style.bold('pawl doctor')} to see which packs are active.`
      : `\n${added} Run "pawl doctor" to see which packs are active.`
  )

  return EXIT_OK
}
