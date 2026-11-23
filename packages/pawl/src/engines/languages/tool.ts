import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { type Finding, type LanguageEngine } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'

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

/** A path a tool printed, relative to the repo root. Undefined when it is outside the repo. */
export const fromEngine = (root: string, cwd: string, path: string): string | undefined => {
  const absolute = isAbsolute(path) ? path : join(cwd, path)
  // Some tools print the real path and some the one they were given, so a root behind a link,
  // as a temporary folder is on macOS, is compared by where it really is.
  const file = toPosix(relative(realPath(root), realPath(absolute)))

  return file.startsWith('../') || file === '..' || isAbsolute(file) ? undefined : file
}

/**
 * A file as an argument a tool reads as a file. A name that starts with a dash would be read as an
 * option, and ktlint reads a leading `!` as "not this one", so such a name gets `./` in front.
 */
export const asArgument = (file: string): string => (/^[-!]/.test(file) ? `./${file}` : file)

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
