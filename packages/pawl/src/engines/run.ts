import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  /** The command as a person would type it, for transparency in output. */
  command: string
}

/** Run a Node script and collect its output. Never rejects on a non-zero exit. */
export const runNode = (script: string, args: readonly string[], cwd: string, label: string): Promise<RunResult> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', code => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        command: [label, ...args].join(' ')
      })
    })
  })

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
