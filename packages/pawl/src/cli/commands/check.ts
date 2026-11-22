/** `pawl check`, `pawl fix` and `pawl baseline`: run the engines, then report or record what they found. */

import { BASELINE_FILE } from '../../check/baseline.ts'
import { check } from '../../check/check.ts'
import { format } from '../../check/output.ts'
import { EXIT_OK, EXIT_SETUP, exitCode, isBlocked } from '../../check/result.ts'
import { plural } from '../../utils/text.ts'
import { type Flags, inCi, maxWarnings, outputFormat, sinceRef } from '../args.ts'
import { colorEnabled, out } from '../io.ts'

export const runCheck = async (root: string, files: string[], flags: Flags, fix: boolean): Promise<number> => {
  const ci = flags.ci === true || inCi(process.env.CI)
  // Every option is read before anything runs: "fix" must not change files and then refuse a flag.
  const kind = outputFormat(flags)
  const limit = maxWarnings(flags)
  const since = sinceRef(flags, files)
  const result = await check({
    root,
    fix,
    changed: flags.changed === true,
    ...(files.length > 0 ? { files } : {}),
    ...(since === undefined ? {} : { since }),
    ...(limit === undefined ? {} : { maxWarnings: limit })
  })

  out(format(result, kind, { color: colorEnabled(), verbose: flags.verbose === true }))

  return exitCode(result, ci)
}

export const runBaseline = async (root: string): Promise<number> => {
  const result = await check({ root, updateBaseline: true })

  if (isBlocked(result.setup)) {
    out(format(result, 'pretty', { color: colorEnabled() }))
    out(`${BASELINE_FILE} was not changed.`)

    return EXIT_SETUP
  }

  out(`Baseline updated: ${plural(result.baselined, 'finding')} recorded in ${BASELINE_FILE}.`)

  return EXIT_OK
}
