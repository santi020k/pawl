import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { type Finding, type LanguageEngine } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'
import { type RunResult, runProgram } from '../engine.ts'

/** One project in another language, as a tool runs it. */
export interface LanguageRun {
  /** The repo root. Findings are relative to it. */
  root: string
  /** The project's folder, relative to the root. Empty for the root itself. */
  dir: string
  /** Only these files, relative to the project's folder. Undefined means the whole project. */
  files?: readonly string[]
  /** Apply safe fixes and format before reporting. */
  write?: boolean
}

export interface LanguageResult {
  findings: Finding[]
  /** The commands that ran, as a person would type them. */
  commands: string[]
  /** The tool that ran, when the runner picks one of several, as Swift's formatter does. */
  engine?: LanguageEngine
}

/** A tool is not installed, as opposed to failing on the code. */
export class ToolMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolMissingError'
  }
}

/** Where a path really is, or the path itself when nothing is there. */
const realPath = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

const realRoots = new Map<string, string>()

/** Where the root really is, looked up once: a report can name thousands of files. */
const realRoot = (root: string): string => {
  const known = realRoots.get(root) ?? realPath(root)

  realRoots.set(root, known)

  return known
}

/** A path relative to a folder, or undefined when it is outside it. */
const inside = (folder: string, absolute: string): string | undefined => {
  const file = toPosix(relative(folder, absolute))

  return file.startsWith('../') || file === '..' || isAbsolute(file) ? undefined : file
}

/**
 * A path a tool printed, relative to the repo root. Undefined when it is outside the repo.
 * The path is taken as printed first, so a linked file keeps the name git has for it. Some tools
 * print the real path and some the one they were given, so a root behind a link, as a temporary
 * folder is on macOS, is then compared by where it really is.
 */
export const fromEngine = (root: string, cwd: string, path: string): string | undefined => {
  const absolute = isAbsolute(path) ? path : join(cwd, path)

  return inside(root, absolute) ?? inside(realRoot(root), absolute) ?? inside(realRoot(root), realPath(absolute))
}

/**
 * A file as an argument a tool reads as a file. A name that starts with a dash would be read as an
 * option, and ktlint reads a leading `!` as "not this one", so such a name gets `./` in front.
 */
export const asArgument = (file: string): string => (/^[-!]/.test(file) ? `./${file}` : file)

/** How long one run of a linter or formatter over a batch of files may take. They finish in seconds. */
const TOOL_TIMEOUT = 10 * 60 * 1000

/** Run a linter or formatter, and stop it when it hangs. */
export const runTool = (program: string, args: readonly string[], cwd: string, command: string): Promise<RunResult> =>
  runProgram(program, args, cwd, command, undefined, TOOL_TIMEOUT)

/** True for a list of objects, the shape of the reports SwiftLint and ktlint print. */
export const isRecordList = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))

/** A number a report gives for a line or a column, or 1 when it gives none. */
export const position = (value: unknown): number => (typeof value === 'number' && value >= 1 ? Math.trunc(value) : 1)

/** The command as a person would type it, with the folder it runs in. */
export const commandIn = (dir: string, command: string): string => (dir ? `(cd ${dir} && ${command})` : command)

/** Keep the findings in the files asked for, which are relative to the project's folder. */
export const onlyFiles = (findings: Finding[], dir: string, files: readonly string[] | undefined): Finding[] => {
  if (!files) return findings

  const wanted = new Set(files.map(file => (dir ? `${dir}/${file}` : file)))

  return findings.filter(finding => wanted.has(finding.file))
}
