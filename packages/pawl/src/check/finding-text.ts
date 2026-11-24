/** How a finding reads in every output: the names of its rule, its fix, and its message on one line. */

import { getRule } from '../catalog/rules.ts'
import { type Finding } from '../types.ts'

/** The engine's own name for the rule, so it can be searched in that engine's docs. */
export const engineLabel = (finding: Finding): string => (finding.engine === 'pawl' ? finding.rule : finding.engineRule)

/** The rule as agents, editors and CI get it: the engine's rule with the engine in front, or pawl's own. */
export const scopedLabel = (finding: Finding): string =>
  finding.engine === 'pawl' ? finding.rule : `${finding.engine}:${finding.engineRule}`

/** How to fix a finding, when pawl knows: its fix command, or the advice of its rule in the catalog. */
export const adviceFor = (finding: Finding, fixCommand = 'pawl fix'): string | undefined =>
  finding.fixable ? `Run "${fixCommand}".` : getRule(finding.rule)?.advice

/** One line of the message, so an engine's message that runs over lines stays one finding. */
export const oneLine = (message: string): string => message.replace(/\s*\n\s*/g, ' ').trim()
