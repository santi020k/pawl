/** `pawl migrate`: turn an ESLint config into a policy, then run `init`. */

import { EXIT_OK } from '../../check/result.ts'
import { planMigrate } from '../../setup/migrate/plan.ts'
import { describeMigration } from '../../setup/migrate/report.ts'
import { applyPlan } from '../../setup/plan.ts'
import { type Flags, packList } from '../args.ts'
import { endDryRun, out, printNotes } from '../io.ts'
import { confirm } from '../prompt.ts'
import { runInit } from './init.ts'

export const runMigrate = async (root: string, flags: Flags): Promise<number> => {
  const plan = await planMigrate({
    root,
    keepConfig: flags['keep-config'] === true,
    ...(flags.extends ? { extends: flags.extends } : {})
  })

  out(describeMigration(plan).join('\n'))

  if (flags['dry-run']) {
    endDryRun(plan.notes)

    return EXIT_OK
  }

  if (!flags.yes && !(await confirm('Write the policy?'))) {
    out('Nothing was changed.')

    return EXIT_OK
  }

  applyPlan(plan)
  out('')

  printNotes(plan.notes)

  out('\nThe policy is written. Setting up the tools next.\n')

  // The packs the old config relied on come along, so their plugins are installed where they are missing.
  const packs = [...new Set([...packList(flags.packs), ...plan.packs])].join(',')

  // So does the policy package the new policy extends, when the project does not list it yet.
  return runInit(
    root,
    packs.length > 0 ? { ...flags, packs } : flags,
    true,
    plan.policyPackage ? [plan.policyPackage] : []
  )
}
