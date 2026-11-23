/** `pawl check`, `pawl fix` and `pawl baseline`: run the engines, then report or record what they found. */

import { BASELINE_FILE } from '../../check/baseline.ts'
import { check } from '../../check/check.ts'
import { format } from '../../check/output.ts'
import { EXIT_OK, EXIT_SETUP, exitCode, isBlocked } from '../../check/result.ts'
import { plural } from '../../utils/text.ts'
import { assertHookFlags, type Flags, inCi, maxWarnings, outputFormat, sinceRef } from '../args.ts'
import { hookFiles, hookMessage, hookReply, hookSetupProblems, readPayload, readStdin } from '../hook.ts'
import { colorEnabled, out } from '../io.ts'

/**
 * The exit code of a hook that could not check the edit. Hosts read 2 as "show the agent", and
 * any other failing code as "tell the person and go on", which is what a setup problem needs.
 */
const HOOK_FAILED = 1

/**
 * `--hook`: fix (or check) only the files the agent's hook input names, and give the agent what
 * is left in the shape its host reads back. Nothing to say means no output and exit code 0.
 */
const runHook = async (root: string, files: string[], flags: Flags, fix: boolean): Promise<number> => {
  assertHookFlags(flags, files)

  const payload = readPayload(await readStdin())
  const edited = hookFiles(root, payload)

  if (edited.length === 0) return EXIT_OK

  try {
    const result = await check({ root, fix, files: edited })
    const problems = hookSetupProblems(result)

    if (problems) {
      process.stderr.write(`${problems}\n`)

      return HOOK_FAILED
    }

    const message = hookMessage(result, fix)
    const reply = message === undefined ? undefined : hookReply(message, payload.reply)

    if (reply) out(reply)

    return EXIT_OK
  } catch (error) {
    // A policy that does not load is the person's to fix, so it goes to stderr like any setup problem.
    process.stderr.write(`pawl: ${error instanceof Error ? error.message : String(error)}\n`)

    return HOOK_FAILED
  }
}

export const runCheck = async (root: string, files: string[], flags: Flags, fix: boolean): Promise<number> => {
  if (flags.hook === true) return runHook(root, files, flags, fix)

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
