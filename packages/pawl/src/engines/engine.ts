import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
 * Run a Node script and collect its output. Never rejects on a non-zero exit.
 * `shown` is what the command reports as having run: the arguments a person would type,
 * without the flags pawl adds to read the output.
 */
export const runNode = (
  script: string,
  args: readonly string[],
  cwd: string,
  label: string,
  shown: readonly string[] = args
): Promise<RunResult> =>
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
        command: [label, ...shown].join(' ')
      })
    })
  })

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

/** The files to hand an engine: the ones asked for, or the whole project. */
export const targets = (files: readonly string[] | undefined): string[] =>
  files && files.length > 0 ? [...files] : ['.']

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
