import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  /** The command as a person would type it, for transparency in output. */
  command: string
}

/**
 * Run a Node script and collect its output. Never rejects on a non-zero exit. A process that could
 * not start at all, such as one whose command line is too long, rejects with an EngineError.
 */
export const runNode = (script: string, args: readonly string[], cwd: string, label: string): Promise<RunResult> =>
  new Promise((resolvePromise, reject) => {
    const command = [label, ...args].join(' ')
    const notStarted = (cause: unknown): void => {
      const reason = cause instanceof Error ? cause.message : String(cause)

      reject(new EngineError(`The process could not be started: ${reason}`, { command, cause }))
    }

    try {
      const child = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', notStarted)
      child.on('close', code => {
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

/**
 * The JSON report in an engine's output, or undefined when there is none to read. A config file or
 * a plugin may print lines of its own first, so when the output does not parse from the first
 * bracket on, the last line that starts with one is tried.
 */
export const readReport = <T>(stdout: string, open: '{' | '['): T | undefined => {
  for (const start of new Set([stdout.indexOf(open), stdout.lastIndexOf(`\n${open}`) + 1])) {
    if (start === -1) continue

    try {
      return JSON.parse(stdout.slice(start)) as T
    } catch {
      // Try the next place.
    }
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
