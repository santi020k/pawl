import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Finding } from '../../types.ts'
import { chunkFiles, EngineError, findOnPath, readReport } from '../engine.ts'
import {
  asArgument,
  commandIn,
  fromEngine,
  isRecordList,
  type LanguageResult,
  type LanguageRun,
  onlyFiles,
  position,
  runTool,
  ToolMissingError
} from './tool.ts'

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/**
 * Turn SwiftLint's JSON report into findings. Throws when the output has no report to read, so
 * other output is never taken for a clean one.
 */
export const parseSwiftLint = (root: string, cwd: string, stdout: string): Finding[] => {
  if (!stdout.includes('[')) return []

  const violations = readReport<unknown>(stdout, '[')

  if (!isRecordList(violations)) throw new Error("Could not read SwiftLint's report.")

  return violations.flatMap(violation => {
    const path = text(violation.file)
    const file = path ? fromEngine(root, cwd, path) : undefined

    if (!file) return []

    const engineRule = text(violation.rule_id) ?? 'swiftlint'

    return [
      {
        file,
        line: position(violation.line),
        column: position(violation.character),
        engine: 'swiftlint',
        engineRule,
        rule: `swiftlint:${engineRule}`,
        severity: text(violation.severity)?.toLowerCase() === 'error' ? 'error' : 'warn',
        message: text(violation.reason) ?? engineRule,
        fixable: false
      } satisfies Finding
    ]
  })
}

/** What SwiftLint says, with exit code 1, when its own `excluded` list leaves none of the files it was given. */
const NOTHING_TO_LINT = 'No lintable files found'

/** Lint a Swift project with SwiftLint, in its own config. `--force-exclude` keeps its `excluded` list in force. */
export const runSwiftLint = async ({ root, dir, files = [], write = false }: LanguageRun): Promise<LanguageResult> => {
  const program = findOnPath('swiftlint')

  if (!program) throw new ToolMissingError('Swift is in the policy, but SwiftLint is not installed.')

  const cwd = join(root, dir)
  const findings: Finding[] = []
  const commands: string[] = []

  for (const batch of chunkFiles(files.map(asArgument))) {
    if (write) {
      const fixed = await runTool(
        program,
        ['lint', '--fix', '--quiet', '--force-exclude', ...batch],
        cwd,
        commandIn(dir, 'swiftlint lint --fix')
      )

      if (!commands.includes(fixed.command)) commands.push(fixed.command)

      // A fix that worked exits with 0, whatever is left to report. Anything else did not run.
      if (fixed.code !== 0 && !(fixed.code === 1 && fixed.stderr.includes(NOTHING_TO_LINT))) {
        throw new EngineError(fixed.stderr.trim() || `SwiftLint exited with code ${fixed.code}.`, {
          command: fixed.command
        })
      }
    }

    const args = ['lint', '--reporter', 'json', '--quiet', '--force-exclude', ...batch]
    const result = await runTool(program, args, cwd, commandIn(dir, 'swiftlint lint'))

    if (!commands.includes(result.command)) commands.push(result.command)

    // The project's own config left these files out, so there is nothing to say about them.
    if (result.code === 1 && result.stderr.includes(NOTHING_TO_LINT)) continue

    // SwiftLint exits with 2 when it finds an error, with a report. Without one, it did not run.
    try {
      if (result.code !== 0 && !result.stdout.includes('[')) throw new Error('no report')

      const found = parseSwiftLint(root, cwd, result.stdout)

      // It said it found something, and the report names nothing in this repo: do not pass that.
      if (result.code !== 0 && found.length === 0) throw new Error('empty report')

      findings.push(...found)
    } catch (cause) {
      throw new EngineError(result.stderr.trim() || `SwiftLint exited with code ${result.code}.`, {
        command: result.command,
        cause
      })
    }
  }

  return { findings: onlyFiles(findings, dir, files), commands }
}

/** A Swift formatter: SwiftFormat, or Apple's swift-format. */
interface SwiftFormatter {
  engine: 'swiftformat' | 'swift-format'
  program: string
  /** `swift format` is swift-format inside the Swift 6 toolchain. */
  prefix: string[]
  /** The command as a person would type it. */
  name: string
}

const swiftFormatTool = (): SwiftFormatter | undefined => {
  const own = findOnPath('swift-format')

  if (own) return { engine: 'swift-format', program: own, prefix: [], name: 'swift-format' }

  const swift = findOnPath('swift')

  return swift ? { engine: 'swift-format', program: swift, prefix: ['format'], name: 'swift format' } : undefined
}

const swiftFormatterTool = (): SwiftFormatter | undefined => {
  const program = findOnPath('swiftformat')

  return program ? { engine: 'swiftformat', program, prefix: [], name: 'swiftformat' } : undefined
}

/**
 * The formatter a Swift project uses: the one whose config it has (`.swiftformat` or
 * `.swift-format`), else SwiftFormat, else swift-format, whichever is installed.
 */
export const swiftFormatterFor = (root: string, dir: string): SwiftFormatter => {
  const config = (name: string): boolean => existsSync(join(root, dir, name))
  const pick = (): SwiftFormatter | undefined => {
    if (config('.swift-format')) return swiftFormatTool()

    if (config('.swiftformat')) return swiftFormatterTool()

    return swiftFormatterTool() ?? swiftFormatTool()
  }
  const chosen = pick()

  if (!chosen) {
    const uses = (config('.swift-format') && 'swift-format') || (config('.swiftformat') && 'SwiftFormat')

    throw new ToolMissingError(
      uses
        ? `Swift is in the policy and the project uses ${uses}, but ${uses} is not installed.`
        : 'Swift is in the policy, but neither SwiftFormat nor swift-format is installed.'
    )
  }

  return chosen
}

/** `file:line:column: warning: [Rule] message` from swift-format, `(rule)` from SwiftFormat. */
const DIAGNOSTIC = /^(.+?):(\d+):(\d+): (warning|error): (?:\[(\w+)\] |\((\w+)\) )?(.*)$/

/**
 * Turn the diagnostics of `swift-format lint` or `swiftformat --lint` into findings. Every one is
 * an error, as an unformatted file is for the other formatters.
 */
export const parseSwiftFormat = (
  root: string,
  cwd: string,
  output: string,
  engine: SwiftFormatter['engine'] = 'swift-format'
): Finding[] =>
  output.split('\n').flatMap(line => {
    const match = DIAGNOSTIC.exec(line.trim())
    const file = match ? fromEngine(root, cwd, match[1] as string) : undefined

    if (!match || !file) return []

    const engineRule = match[5] ?? match[6] ?? 'format'

    return [
      {
        file,
        line: Math.max(1, Number(match[2])),
        column: Math.max(1, Number(match[3])),
        engine,
        engineRule,
        rule: `${engine}:${engineRule}`,
        severity: 'error',
        message: match[7] as string,
        fixable: false
      } satisfies Finding
    ]
  })

/** The arguments that check, and those that apply, the formatting of some files. */
const formatArgs = (formatter: SwiftFormatter, files: readonly string[], write: boolean): string[] => {
  // SwiftFormat prints what lint finds as warnings, which --quiet would hide.
  if (formatter.engine === 'swiftformat') return write ? ['--quiet', ...files] : ['--lint', ...files]

  return [...formatter.prefix, ...(write ? ['format', '--in-place'] : ['lint', '--strict']), '--parallel', ...files]
}

/**
 * Check, or apply, the formatting of a Swift project, with SwiftFormat or swift-format in the
 * project's own config.
 */
export const runSwiftFormat = async ({
  root,
  dir,
  files = [],
  write = false
}: LanguageRun): Promise<LanguageResult> => {
  const formatter = swiftFormatterFor(root, dir)
  const label = (fix: boolean): string =>
    commandIn(
      dir,
      formatter.engine === 'swiftformat'
        ? `swiftformat${fix ? '' : ' --lint'}`
        : `${formatter.name} ${fix ? 'format --in-place' : 'lint --strict'}`
    )
  const cwd = join(root, dir)
  const findings: Finding[] = []
  const commands: string[] = []

  for (const batch of chunkFiles(files.map(asArgument))) {
    if (write) {
      const formatted = await runTool(formatter.program, formatArgs(formatter, batch, true), cwd, label(true))

      if (!commands.includes(formatted.command)) commands.push(formatted.command)

      if (formatted.code !== 0) {
        throw new EngineError(formatted.stderr.trim() || `${formatter.name} exited with code ${formatted.code}.`, {
          command: formatted.command
        })
      }
    }

    const result = await runTool(formatter.program, formatArgs(formatter, batch, false), cwd, label(false))
    // The diagnostics go to stderr; some versions print them to stdout.
    const found = parseSwiftFormat(root, cwd, `${result.stderr}\n${result.stdout}`, formatter.engine)

    if (!commands.includes(result.command)) commands.push(result.command)

    // Both exit with 1 when a file needs formatting. Anything else, or 1 with nothing to show, is a failure.
    if (result.code !== 0 && found.length === 0) {
      throw new EngineError(result.stderr.trim() || `${formatter.name} exited with code ${result.code}.`, {
        command: result.command
      })
    }

    findings.push(...found)
  }

  return { findings: onlyFiles(findings, dir, files), commands, engine: formatter.engine }
}
