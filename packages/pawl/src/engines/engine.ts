import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join, resolve } from 'node:path'
import { type Project } from '../policy/project.ts'
import { type Toolset } from '../project/toolset.ts'
import { type EngineName, type Finding, type SetupIssue } from '../types.ts'
import { readJson } from '../utils/json.ts'

/** What every engine run takes. */
export interface RunOptions {
  root: string
  /** Files to check, relative to the root. Omit to check the whole project. */
  files?: readonly string[]
  /** Apply safe fixes and formatting. */
  write?: boolean
  /**
   * The patterns pawl skips, for an engine that has no config file to read them from. Prettier is
   * the one: every other engine gets them through the config pawl writes.
   */
  ignore?: readonly string[]
  /** The policy follows the .gitignore. True when not given. Only an engine with no config for it reads this. */
  gitignore?: boolean
}

/** An engine's config files, as the check and the doctor report them. */
export interface EngineState {
  /** The config file pawl reads or writes for the engine, relative to the root. */
  config?: string
  /** How that file compares with the policy, such as `ok` or `stale`. */
  status?: string
  /** False while the engine cannot run, such as before its config file exists. */
  runnable: boolean
  /** What is wrong with the setup. A blocking one stops the check. */
  issues: SetupIssue[]
}

/**
 * One engine pawl drives. The check and the doctor go through this, so every engine is
 * set up, checked for, run and reported the same way.
 */
export interface Engine {
  name: EngineName | 'prettier'
  /** The package that installs it. */
  packageName: string
  /** The versions pawl works with: the exact Biome it pins, or the peer range. */
  range: string | undefined
  /** It runs in a project with these tools. */
  active: (tools: Toolset) => boolean
  installed: (root: string) => boolean
  /** The setup problem when the project runs the engine but has not installed it. */
  missing: SetupIssue
  /** Compare the engine's config files with what the policy calls for. */
  inspect: (project: Project) => EngineState
  run: (options: RunOptions) => Promise<EngineRun>
}

/** What every engine run gives back. */
export interface EngineRun {
  findings: Finding[]
  /** The command that ran, as a person would type it. */
  command: string
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  /** The command as a person would type it, for transparency in output. */
  command: string
}

/**
 * Find a program on the PATH, as a shell would. Reads the file system only, so `pawl doctor`
 * can say what is missing without running anything.
 */
export const findOnPath = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']

  for (const dir of dirs) {
    for (const extension of extensions) {
      // Absolute, so a relative PATH entry names the same file from the folder the program runs in.
      const file = resolve(dir, `${name}${extension}`)

      try {
        accessSync(file, constants.X_OK)

        if (statSync(file).isFile()) return file
      } catch {
        // Not here.
      }
    }
  }

  return undefined
}

/**
 * Run a Node script and collect its output. Never rejects on a non-zero exit. A process that could
 * not start at all, such as one whose command line is too long, rejects with an EngineError.
 * `shown` is what the command reports as having run: the arguments a person would type,
 * without the flags pawl adds to read the output.
 */
export const runNode = (
  script: string,
  args: readonly string[],
  cwd: string,
  label: string,
  shown: readonly string[] = args,
  env?: Record<string, string>
): Promise<RunResult> => runProgram(process.execPath, [script, ...args], cwd, [label, ...shown].join(' '), env)

/**
 * Run a program and collect its output, as `runNode` does for a Node script. `command` is the
 * command as a person would type it. With `timeoutMs`, a program that is still running after that
 * long is stopped and the run rejects with an EngineError, so a tool that hangs cannot hang the check.
 */
export const runProgram = (
  program: string,
  args: readonly string[],
  cwd: string,
  command: string,
  env?: Record<string, string>,
  timeoutMs?: number
): Promise<RunResult> =>
  new Promise((resolvePromise, reject) => {
    const notStarted = (cause: unknown): void => {
      const reason = cause instanceof Error ? cause.message : String(cause)

      reject(new EngineError(`The process could not be started: ${reason}`, { command, cause }))
    }

    try {
      // Pawl reads what an engine prints and formats its own output, so no engine colours its text.
      // A task runner such as Turborepo sets FORCE_COLOR, and Prettier then colours even its errors.
      const childEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env }
      const child = spawn(program, args, {
        cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              child.kill('SIGKILL')
              reject(
                new EngineError(
                  `The process did not finish in ${Math.round(timeoutMs / 1000)} seconds and was stopped.`,
                  {
                    command
                  }
                )
              )
            }, timeoutMs)

      child.on('error', cause => {
        clearTimeout(timer)
        notStarted(cause)
      })
      child.on('close', code => {
        clearTimeout(timer)
        resolvePromise({
          code: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          command
        })
      })
    } catch (error) {
      // Node reports some failures to start in the error event, and throws the others from spawn.
      notStarted(error)
    }
  })

/**
 * The most characters of file names one engine run is given. Windows refuses a command line over
 * about 32,000 characters, and the engine's own path and flags have to fit on it too. Linux and
 * macOS allow far more, but one limit everywhere makes a run the same on every machine.
 */
export const FILES_BUDGET = 24_000

/** What a file name takes on a command line: itself, a space, and the quotes Windows may put around it. */
const cost = (file: string): number => file.length + 3

/**
 * Split a file list into chunks that each fit on one command line, in the order given. A name
 * longer than the budget still gets a chunk of its own, for the system to take or refuse.
 */
export const chunkFiles = (files: readonly string[], budget: number = FILES_BUDGET): string[][] => {
  const chunks: string[][] = []
  let used = 0

  for (const file of files) {
    const last = chunks.at(-1)

    if (last && used + cost(file) <= budget) {
      last.push(file)
      used += cost(file)
    } else {
      chunks.push([file])
      used = cost(file)
    }
  }

  return chunks
}

/**
 * Run an engine on the files a caller named, or on the whole project when none are named. A list
 * too long for one command line takes one run for each chunk, one after the other, so that a fix
 * is on disk before the next run starts.
 *
 * `shown` is the command without its files, as a person would type it. One run is reported with
 * its files; several are reported once, with a count in place of thousands of paths.
 */
export const runChunked = async <F>(
  files: readonly string[] | undefined,
  shown: string,
  run: (targets: readonly string[]) => Promise<F[]>
): Promise<{ findings: F[]; command: string }> => {
  const named = files ?? []
  const chunks = named.length > 0 ? chunkFiles(named) : [['.']]
  const runs: F[][] = []

  for (const chunk of chunks) runs.push(await run(chunk))

  const [only = []] = chunks
  const targets = chunks.length === 1 ? only.join(' ') : `(${named.length} files in ${chunks.length} runs)`

  return { findings: runs.flat(), command: `${shown} ${targets}` }
}

/** How many lines readReport tries. Each try reads the rest of the output, so they are counted. */
const REPORT_TRIES = 32

/**
 * The JSON report in an engine's output, or undefined when there is none to read. A config file or
 * a plugin may print lines of its own first, so when the output does not parse from the first
 * bracket on, the lines that start with one are tried, from the top. The report is the first that
 * parses to the end: the lines before it never do, and the lines inside it are not reached.
 */
export const readReport = <T>(stdout: string, open: '{' | '['): T | undefined => {
  let start = stdout.indexOf(open)

  for (let tries = 0; start !== -1 && tries < REPORT_TRIES; tries++) {
    try {
      return JSON.parse(stdout.slice(start)) as T
    } catch {
      // Try the next line that starts with the bracket.
    }

    const next = stdout.indexOf(`\n${open}`, start)

    start = next === -1 ? -1 : next + 1
  }

  return undefined
}

/** An engine could not run, or its output could not be read. */
export class EngineError extends Error {
  /** The command that failed, as a person would type it. */
  readonly command: string

  constructor(message: string, { command, cause }: { command: string; cause?: unknown }) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'EngineError'
    this.command = command
  }
}

/**
 * An engine's JSON report, or an EngineError that says why there is none. `valid` checks the
 * shape, so other JSON the engine or a plugin printed is not taken for the report.
 */
export const parseReport = <T>(
  result: RunResult,
  engine: string,
  open: '{' | '[',
  valid: (report: unknown) => report is T
): T => {
  const report = readReport<unknown>(result.stdout, open)

  if (report !== undefined && valid(report)) return report

  if (!result.stdout.includes(open)) {
    throw new EngineError(
      result.stderr.trim() || result.stdout.trim() || `${engine} exited with code ${result.code} and no report.`,
      { command: result.command }
    )
  }

  throw new EngineError(`Could not read ${engine}'s report.\n${result.stderr.trim()}`.trim(), {
    command: result.command
  })
}

export interface BinLookup {
  /** The package that ships the bin, such as `@biomejs/biome`. */
  packageName: string
  /** The bin's name, when the package has several. */
  bin: string
  /** Where the bin is when the package does not say. */
  fallback: string
  /** Also look beside pawl itself, for an engine pawl can bring along. */
  besidePawl?: boolean
}

/** The path of a tool's bin as the project would run it, or undefined when it is not installed. */
export const resolveBin = (
  root: string,
  { packageName, bin, fallback, besidePawl = false }: BinLookup
): string | undefined => {
  for (const from of [join(root, 'package.json'), ...(besidePawl ? [import.meta.filename] : [])]) {
    try {
      const manifestPath = createRequire(from).resolve(`${packageName}/package.json`)
      const field = readJson<{ bin?: string | Record<string, string> }>(manifestPath)?.bin
      const entry = (typeof field === 'string' ? field : field?.[bin]) ?? fallback
      const path = join(dirname(manifestPath), entry)

      if (existsSync(path)) return path
    } catch {
      // Not installed there. Try the next place.
    }
  }

  return undefined
}
