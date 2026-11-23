/** `pawl sync`: rewrite the engine config files after the policy changed. */

import { EXIT_OK } from '../../check/result.ts'
import { formatWritten } from '../../setup/init.ts'
import { planSync } from '../../setup/sync.ts'
import { terminal } from '../audience.ts'
import { out } from '../io.ts'

export const runSync = async (root: string): Promise<number> => {
  const { actions, notes, tools } = await planSync(root)
  const { rich, style, sym } = terminal()
  const done = (text: string): string => (rich ? `${style.accent(sym.tick)} ${text}` : text)

  for (const action of actions) {
    action.apply()
    out(done(`${action.kind === 'create' ? 'Wrote' : 'Updated'} ${action.path}`))
  }

  if (tools.biome) {
    await formatWritten(
      root,
      actions.map(action => action.path)
    )
  }

  if (actions.length === 0 && notes.length === 0) {
    out(
      done(
        tools.biome || tools.formatter === 'prettier'
          ? 'Config files are up to date.'
          : 'ESLint reads the policy live, so there is nothing to sync.'
      )
    )
  }

  for (const note of notes) out(rich ? `${style.cyan(sym.info)} ${note}` : `Note: ${note}`)

  return EXIT_OK
}
