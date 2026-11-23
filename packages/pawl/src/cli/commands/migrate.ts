/** `pawl migrate`: turn an ESLint config into a policy, then run `init`. */

import { EXIT_OK } from '../../check/result.ts'
import { planMigrate } from '../../setup/migrate/plan.ts'
import { describeMigration } from '../../setup/migrate/report.ts'
import { applyPlan } from '../../setup/plan.ts'
import { VERSION } from '../../version.ts'
import { type Flags, packList } from '../args.ts'
import { terminal } from '../audience.ts'
import { endDryRun, out, printNotes } from '../io.ts'
import { confirm } from '../prompt.ts'
import { rail } from '../ui.ts'
import { runInit } from './init.ts'

export const runMigrate = async (root: string, flags: Flags): Promise<number> => {
  const term = terminal()
  const ui = term.rich ? rail(term) : undefined
  const plan = await planMigrate({
    root,
    keepConfig: flags['keep-config'] === true,
    ...(flags.extends ? { extends: flags.extends } : {})
  })

  if (ui) {
    const [read = '', ...rest] = describeMigration(plan)

    ui.start(`${term.style.accentBadge(' pawl ')} migrate  ${term.style.dim(VERSION)}`)
    ui.step(read.replace(/^Read +/, 'Read '), rest)
  } else {
    out(describeMigration(plan).join('\n'))
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

  if (!flags.yes && !(await confirm('Write the policy?'))) {
    if (ui) ui.end('Nothing was changed.')
    else out('Nothing was changed.')

    return EXIT_OK
  }

  applyPlan(plan)

  if (ui) {
    for (const note of plan.notes) ui.note(note)

    ui.step('The policy is written. Setting up the tools next.')
  } else {
    out('')
    printNotes(plan.notes)
    out('\nThe policy is written. Setting up the tools next.\n')
  }

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
