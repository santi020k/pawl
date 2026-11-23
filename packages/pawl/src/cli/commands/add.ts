/** `pawl add`: switch packs on and install their ESLint plugins. */

import { EXIT_OK, EXIT_SETUP } from '../../check/result.ts'
import { planAdd } from '../../setup/add.ts'
import { applyPlan, describeActions } from '../../setup/plan.ts'
import { type Flags } from '../args.ts'
import { endDryRun, out, printNotes, runInstall } from '../io.ts'

export const runAdd = async (root: string, names: string[], flags: Flags): Promise<number> => {
  const plan = await planAdd(root, names, flags['no-install'] !== true)

  for (const line of describeActions(plan.actions)) out(line)

  if (plan.install) out(`Run    ${plan.install}`)

  if (flags['dry-run']) {
    endDryRun(plan.notes)

    return EXIT_OK
  }

  applyPlan(plan)

  const installed = plan.install === undefined || runInstall(root, plan.install)

  printNotes(plan.notes)

  if (!installed) return EXIT_SETUP

  out(`\nAdded: ${names.join(', ')}. Run "pawl doctor" to see which packs are active.`)

  return EXIT_OK
}
