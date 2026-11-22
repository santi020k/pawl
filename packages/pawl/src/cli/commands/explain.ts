/** `pawl explain`: what a rule does and the level it has in this repo. */

import { EXIT_FINDINGS, EXIT_OK } from '../../check/result.ts'
import { loadPolicy } from '../../policy/load.ts'
import { explainRule } from '../../report/explain.ts'
import { UsageError } from '../args.ts'
import { out } from '../io.ts'

export const runExplain = async (root: string, query: string | undefined): Promise<number> => {
  if (!query) throw new UsageError('Which rule? For example: pawl explain no-console')

  const lines = explainRule(await loadPolicy(root), query, root)

  if (!lines) {
    out(`"${query}" is not in the pawl catalog. If it is an engine rule, see that engine's documentation.`)

    return EXIT_FINDINGS
  }

  out(lines.join('\n'))

  return EXIT_OK
}
