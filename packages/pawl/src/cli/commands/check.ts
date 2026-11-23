/** `pawl check`, `pawl fix` and `pawl baseline`: run the engines, then report or record what they found. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASELINE_FILE } from '../../check/baseline.ts'
import { type CheckOptions, type CheckProgress, check } from '../../check/check.ts'
import { engineTitle, format, type RichOptions } from '../../check/output.ts'
import { type CheckResult, EXIT_OK, EXIT_SETUP, exitCode, isBlocked } from '../../check/result.ts'
import { plural } from '../../utils/text.ts'
import { assertHookFlags, type Flags, formatFromEnv, inCi, maxWarnings, outputFormat, sinceRef } from '../args.ts'
import { type Terminal, terminal } from '../audience.ts'
import { hookFiles, hookMessage, hookReply, hookSetupProblems, readPayload, readStdin } from '../hook.ts'
import { out } from '../io.ts'
import { spinner } from '../ui.ts'

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

/** A file's text, read once however many findings point into it. */
const sourceReader = (root: string): ((file: string) => string | undefined) => {
  const cache = new Map<string, string | undefined>()

  return file => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(join(root, file), 'utf8'))
      } catch {
        cache.set(file, undefined)
      }
    }

    return cache.get(file)
  }
}

/**
 * Run the check with a spinner for a person watching, on stderr so the report on stdout stays
 * clean when it is piped. The spinner names each engine as it starts and ends.
 */
const checkWithSpinner = async (
  term: Terminal,
  options: CheckOptions,
  verb: string
): Promise<{ result: CheckResult; elapsedMs: number }> => {
  const started = performance.now()

  if (!term.animate || process.stderr.isTTY !== true) {
    const result = await check(options)

    return { result, elapsedMs: performance.now() - started }
  }

  const { style, sym } = term
  const running = new Set<string>()
  const finished: string[] = []
  const status = spinner(term, process.stderr, `${verb}${sym.ellipsis}`)
  const label = (): string => {
    const done = finished.map(name => `${style.accent(sym.tick)} ${engineTitle(name)}`)
    const busy = [...running].map(name => style.dim(engineTitle(name)))

    return `${verb} ${[...done, ...busy].join(style.dim('  '))}`
  }
  const progress = (event: CheckProgress): void => {
    if (event.done) {
      running.delete(event.engine)
      finished.push(event.engine)
    } else {
      running.add(event.engine)
    }

    status.update(label())
  }

  try {
    const result = await check({ ...options, progress })

    return { result, elapsedMs: performance.now() - started }
  } finally {
    status.clear()
  }
}

export const runCheck = async (root: string, files: string[], flags: Flags, fix: boolean): Promise<number> => {
  if (flags.hook === true) return runHook(root, files, flags, fix)

  const term = terminal()
  const ci = flags.ci === true || inCi(process.env.CI)
  // Every option is read before anything runs: "fix" must not change files and then refuse a flag.
  // --format wins, then PAWL_FORMAT from a program that reads pawl, then a coding agent's own format.
  const kind = outputFormat(flags, formatFromEnv(process.env) ?? (term.agent ? 'agent' : 'pretty'))
  const limit = maxWarnings(flags)
  const since = sinceRef(flags, files)
  const options: CheckOptions = {
    root,
    fix,
    changed: flags.changed === true,
    ...(files.length > 0 ? { files } : {}),
    ...(since === undefined ? {} : { since }),
    ...(limit === undefined ? {} : { maxWarnings: limit })
  }
  const rich = kind === 'pretty' && term.rich

  if (!rich) {
    const result = await check(options)

    out(format(result, kind, { verbose: flags.verbose === true }))

    return exitCode(result, ci)
  }

  const { result, elapsedMs } = await checkWithSpinner(term, options, fix ? 'Fixing' : 'Checking')
  const view: RichOptions = { ...term, source: sourceReader(root), elapsedMs, ci }

  out(format(result, kind, { verbose: flags.verbose === true, rich: view }))

  return exitCode(result, ci)
}

export const runBaseline = async (root: string): Promise<number> => {
  const term = terminal()
  const { result } = await checkWithSpinner(term, { root, updateBaseline: true }, 'Recording')
  const { style, sym } = term

  if (isBlocked(result.setup)) {
    out(format(result, 'pretty', term.rich ? { rich: { ...term, ci: false } } : {}))
    out(`${BASELINE_FILE} was not changed.`)

    return EXIT_SETUP
  }

  const line = `Baseline updated: ${plural(result.baselined, 'finding')} recorded in ${BASELINE_FILE}.`

  out(term.rich ? `${style.accent(sym.tick)} ${line}` : line)

  return EXIT_OK
}
