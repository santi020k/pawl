/** `pawl check`, `pawl fix` and `pawl baseline`: run the engines, then report or record what they found. */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BASELINE_FILE } from '../../check/baseline.ts'
import { type CheckOptions, type CheckProgress, check } from '../../check/check.ts'
import { engineTitle, format, type OutputFormat, type RichOptions, unparsedNote } from '../../check/output.ts'
import { type CheckResult, EXIT_FINDINGS, EXIT_OK, EXIT_SETUP, exitCode, isBlocked } from '../../check/result.ts'
import {
  BIOME_CONFIG_FILES,
  ESLINT_CONFIG_FILES,
  hasAny,
  OXLINT_CONFIG_FILES,
  PAWL_CONFIG_FILES
} from '../../project/config-files.ts'
import { projectPath } from '../../project/files.ts'
import { ancestors } from '../../utils/fs.ts'
import { plural } from '../../utils/text.ts'
import { assertHookFlags, type Flags, formatFromEnv, inCi, maxWarnings, outputFormat, sinceRef } from '../args.ts'
import { type Terminal, terminal } from '../audience.ts'
import { guardFinding, guardReply, readGuardPayload } from '../guard.ts'
import {
  handOffMessage,
  hookFiles,
  hookMessage,
  hookReply,
  hookSetupProblems,
  readPayload,
  readStdin,
  readStopPayload,
  type StopPayload,
  stopReply,
  stopVerdict
} from '../hook.ts'
import { clearSession, editedFiles, readStopState, recordEdits, writeStopState } from '../hook-state.ts'
import { out } from '../io.ts'
import { spinner } from '../ui.ts'

/**
 * The exit code of a hook that could not check the edit. Hosts read 2 as "show the agent", and
 * any other failing code as "tell the person and go on", which is what a setup problem needs.
 */
const HOOK_FAILED = 1

/**
 * Run the check of a hook. What stops it is the person's to fix, so it goes to stderr: a setup
 * problem, or a policy that does not load. Undefined then, and the hook exits with HOOK_FAILED.
 */
const hookCheck = async (root: string, fix: boolean, files: string[]): Promise<CheckResult | undefined> => {
  try {
    const result = await check({ root, fix, files })
    const problems = hookSetupProblems(result)

    if (!problems) return result

    process.stderr.write(`${problems}\n`)
  } catch (error) {
    process.stderr.write(`pawl: ${error instanceof Error ? error.message : String(error)}\n`)
  }

  return undefined
}

/**
 * The stop hook: check every file the agent edited in the session, and send the agent back to
 * work while new errors are left. Once it is done, or pawl hands what is left to the person, the
 * session's edits are forgotten, so the next turn starts clean.
 */
const runStopHook = async (root: string, payload: StopPayload, fix: boolean): Promise<number> => {
  const { session } = payload

  if (session === undefined || !payload.finished) return EXIT_OK

  const edited = hookFiles(root, { files: editedFiles(root, session), cwd: root, reply: 'none' })

  if (edited.length === 0) {
    clearSession(root, session)

    return EXIT_OK
  }

  const result = await hookCheck(root, fix, edited)

  if (!result) return HOOK_FAILED

  const verdict = stopVerdict(result, fix, payload.continuing, readStopState(root, session))

  if (verdict.kind === 'back') {
    writeStopState(root, session, verdict.state)
    out(stopReply(verdict.message, payload.reply))

    return EXIT_OK
  }

  clearSession(root, session)

  if (verdict.kind === 'hand-off') {
    const message = handOffMessage(verdict.count)

    // Claude Code and Codex show a hook's systemMessage to the person; Cursor shows its stderr.
    if (payload.reply === 'decision') out(JSON.stringify({ systemMessage: message }))
    else process.stderr.write(`${message}\n`)
  }

  return EXIT_OK
}

/**
 * `--hook`: fix (or check) only the files the agent's hook input names, and give the agent what
 * is left in the shape its host reads back. Nothing to say means no output and exit code 0. A
 * stop event runs the stop hook instead.
 */
const runHook = async (root: string, cwd: string, files: string[], flags: Flags, fix: boolean): Promise<number> => {
  assertHookFlags(flags, files)

  const text = await readStdin()
  // Before a tool runs: hand a change to what the check allows to a person. Nothing else runs.
  const guard = readGuardPayload(text, { copilot: !fix })

  if (guard) {
    // The guard finds the top of the repository itself, and reads a relative path from where the hook started.
    const reply = guardReply(guard, guardFinding(cwd, guard))

    if (reply) out(reply)

    return EXIT_OK
  }

  const stop = readStopPayload(text)

  if (stop) return runStopHook(root, stop, fix)

  const payload = readPayload(text)
  const edited = hookFiles(root, { ...payload, cwd: payload.cwd ?? cwd })

  if (edited.length === 0) return EXIT_OK

  // Remembered for the stop hook, which checks all of the agent's edits once more as it finishes.
  if (payload.session !== undefined) recordEdits(root, payload.session, edited)

  const result = await hookCheck(root, fix, edited)

  if (!result) return HOOK_FAILED

  const message = hookMessage(result, fix)
  const reply = message === undefined ? undefined : hookReply(message, payload.reply)

  if (reply) out(reply)

  return EXIT_OK
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

/**
 * The folder pawl runs in, from the root of the repository a GitHub Actions job checked out, so the
 * paths of `--format github` and `--format sarif` point at the right files. Empty at that root and
 * outside GitHub Actions, where the paths stay as pawl names them.
 */
export const workspaceBase = (root: string, env: Readonly<Record<string, string | undefined>>): string => {
  const workspace = env.GITHUB_WORKSPACE

  if (!workspace) return ''

  const path = projectPath(resolve(workspace), resolve(root))

  return path === undefined || path === '.' ? '' : path
}

/**
 * The format when neither `--format` nor `PAWL_FORMAT` names one: `agent` for a coding agent, even one
 * that runs in GitHub Actions, `github` in any other GitHub Actions job, which puts each new finding
 * on its line in the pull request and prints the plain report after it, and `pretty` everywhere else.
 */
export const defaultFormat = (
  agent: string | undefined,
  env: Readonly<Record<string, string | undefined>>
): OutputFormat => {
  if (agent) return 'agent'

  return env.GITHUB_ACTIONS === 'true' ? 'github' : 'pretty'
}

/** What marks the folder pawl runs from: its policy, its baseline, or a config of an engine it runs. */
const ROOT_FILES = [
  ...PAWL_CONFIG_FILES,
  BASELINE_FILE,
  ...BIOME_CONFIG_FILES,
  ...OXLINT_CONFIG_FILES,
  ...ESLINT_CONFIG_FILES
]

/**
 * The folder a check runs from: the one pawl started in, or, when that has none of pawl's files,
 * the nearest folder above it in the same git repository that has. In a package of a monorepo, or
 * in a folder such as src, that is the root, where pawl runs once and covers every package.
 * Outside a git repository, the folder pawl started in.
 */
export const checkRoot = (cwd: string): string => {
  let found: string | undefined

  for (const dir of ancestors(cwd)) {
    found ??= hasAny(dir, ROOT_FILES) ? dir : undefined

    // The root counts only when it is inside the repository pawl started in: a config in a folder
    // above a project with no git, such as the home folder, is not that project's.
    if (existsSync(join(dir, '.git'))) return found ?? cwd
  }

  return cwd
}

/**
 * `pawl check` and `pawl fix`, started in `cwd`. The files named are relative to `cwd`; the check
 * runs from the root `checkRoot` finds.
 */
export const runCheck = async (cwd: string, named: string[], flags: Flags, fix: boolean): Promise<number> => {
  const root = checkRoot(cwd)
  const files = named.map(file => resolve(cwd, file))

  if (flags.hook === true) return runHook(root, cwd, named, flags, fix)

  const term = terminal()
  const ci = flags.ci === true || inCi(process.env.CI)
  // Every option is read before anything runs: "fix" must not change files and then refuse a flag.
  // --format wins, then PAWL_FORMAT from a program that reads pawl, then a coding agent's own format,
  // then GitHub Actions annotations in a GitHub Actions job.
  const fallback = flags.format === undefined ? formatFromEnv(process.env) : undefined
  const kind = outputFormat(flags, fallback ?? defaultFormat(term.agent, process.env))
  const limit = maxWarnings(flags)
  const since = sinceRef(flags, files)
  const options: CheckOptions = {
    root,
    fix,
    eslintCache: flags['eslint-cache'] === true,
    changed: flags.changed === true,
    ...(files.length > 0 ? { files } : {}),
    ...(since === undefined ? {} : { since }),
    ...(limit === undefined ? {} : { maxWarnings: limit })
  }
  const rich = kind === 'pretty' && term.rich

  if (!rich) {
    const result = await check(options)

    out(
      format(result, kind, {
        verbose: flags.verbose === true,
        ci,
        base: workspaceBase(root, process.env)
      })
    )

    return exitCode(result, ci)
  }

  const { result, elapsedMs } = await checkWithSpinner(term, options, fix ? 'Fixing' : 'Checking')
  const view: RichOptions = { ...term, source: sourceReader(root), elapsedMs, ci }

  out(format(result, kind, { verbose: flags.verbose === true, rich: view }))

  return exitCode(result, ci)
}

export const runBaseline = async (cwd: string): Promise<number> => {
  const term = terminal()
  const { result } = await checkWithSpinner(term, { root: checkRoot(cwd), updateBaseline: true }, 'Recording')
  const { style, sym } = term

  if (isBlocked(result.setup)) {
    out(format(result, 'pretty', term.rich ? { rich: { ...term, ci: false } } : {}))
    out(`${BASELINE_FILE} was not changed.`)

    return EXIT_SETUP
  }

  const line = `Baseline updated: ${plural(result.baselined, 'finding')} recorded in ${BASELINE_FILE}.`
  const unparsed = unparsedNote(result.findings)

  out(term.rich ? `${style.accent(sym.tick)} ${line}` : line)

  if (unparsed.length === 0) return EXIT_OK

  // A file that does not parse was not checked, so its parse errors still fail the check.
  const [header = '', ...files] = unparsed

  out([term.rich ? `${style.red(sym.cross)} ${header}` : header, ...files].join('\n'))

  return EXIT_FINDINGS
}
