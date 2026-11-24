/** `pawl sync`: rewrite the engine config files after the policy changed. */

import { EXIT_OK } from '../../check/result.ts'
import { formatWritten } from '../../setup/init.ts'
import { describeActions } from '../../setup/plan.ts'
import { planSync } from '../../setup/sync.ts'
import { type Flags } from '../args.ts'
import { endDryRun, out } from '../io.ts'

export const runSync = async (root: string, flags: Pick<Flags, 'dry-run'> = {}): Promise<number> => {
  const { actions, notes, tools } = await planSync(root)

  if (flags['dry-run']) {
    for (const line of describeActions(actions)) out(line)

    endDryRun(notes)

    return EXIT_OK
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
