import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  /** The command as a person would type it, for transparency in output. */
  command: string
}

/** Run a Node script and collect its output. Never rejects on a non-zero exit. */
export const runNode = (script: string, args: readonly string[], cwd: string, label: string): Promise<RunResult> =>
  runProgram(process.execPath, [script, ...args], cwd, [label, ...args].join(' '))

/**
 * Find a program on the PATH, as a shell would. Reads the file system only, so `pawl doctor`
 * can say what is missing without running anything.
 */
export const findOnPath = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']

  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = join(dir, `${name}${extension}`)

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

/** Run a program and collect its output. `label` is the command as a person would type it. Never rejects on a non-zero exit. */
export const runProgram = (
  program: string,
  args: readonly string[],
  cwd: string,
  label: string,
  env?: NodeJS.ProcessEnv
): Promise<RunResult> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {})
    })
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
        command: label
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
