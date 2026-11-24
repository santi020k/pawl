/** `pawl upgrade`: install the tool versions this pawl works with, then sync the config files. */

import { EXIT_OK, EXIT_SETUP } from '../../check/result.ts'
import { planUpgrade } from '../../setup/upgrade.ts'
import { type Flags } from '../args.ts'
import { terminal } from '../audience.ts'
import { endDryRun, installQuietly, out, printNotes, runInstall, tail } from '../io.ts'
import { spinner } from '../ui.ts'
import { runSync } from './sync.ts'

export const runUpgrade = async (root: string, flags: Flags): Promise<number> => {
  const plan = await planUpgrade(root)
  const term = terminal()
  const { rich, style, sym } = term

  for (const upgrade of plan.upgrades) {
    const line = `${upgrade.name} ${upgrade.installed} is outside ${upgrade.wanted}: installing ${upgrade.spec}`

    out(rich ? `${style.yellow('~')} ${line}` : line)
  }

  if (plan.install) out(rich ? `${style.dim('$')} ${plan.install}` : `Run    ${plan.install}`)

  if (flags['dry-run']) {
    if (rich) {
      for (const note of plan.notes) out(`${style.cyan(sym.info)} ${note}`)

      out(style.dim('Dry run. Nothing was changed. "pawl sync --dry-run" shows the config files a sync would write.'))
    } else {
      endDryRun([...plan.notes, '"pawl sync --dry-run" shows the config files a sync would write.'])
    }

    return EXIT_OK
  }

  if (plan.install !== undefined && flags['no-install'] !== true) {
    let installed: boolean

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

    if (!installed) {
      if (rich) for (const note of plan.notes) out(`${style.cyan(sym.info)} ${note}`)
      else printNotes(plan.notes)

      return EXIT_SETUP
    }
  }

  if (plan.upgrades.length === 0) {
    const line = 'Every tool is a version this pawl works with.'

    out(rich ? `${style.accent(sym.tick)} ${line}` : line)
  }

  if (rich) for (const note of plan.notes) out(`${style.cyan(sym.info)} ${note}`)
  else printNotes(plan.notes)

  // The config files last, with the new versions in place: Oxlint's rules and Biome's schema follow them.
  return runSync(root)
}
