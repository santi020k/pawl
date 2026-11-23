import { join } from 'node:path'
import { type Finding } from '../../types.ts'
import { EngineError, findOnPath, type RunResult, runProgram } from '../engine.ts'
import { commandIn, fromEngine, type LanguageResult, type LanguageRun, onlyFiles, ToolMissingError } from './tool.ts'

/** Rustup installs a stand-in for every tool, which says when its component is missing. */
const MISSING_COMPONENT = /is not installed for the toolchain|no such (?:sub)?command: [`']?(?:clippy|fmt)/i

const cargo = (): string => {
  const found = findOnPath('cargo')

  if (!found) throw new ToolMissingError('Rust is in the policy, but cargo is not installed.')

  return found
}

const run = async (dir: string, root: string, args: readonly string[]): Promise<RunResult> => {
  const cwd = join(root, dir)
  const result = await runProgram(cargo(), args, cwd, commandIn(dir, ['cargo', ...args].join(' ')), {
    CARGO_TERM_COLOR: 'never'
  })

  if (MISSING_COMPONENT.test(result.stderr)) {
    const component = args[0] === 'fmt' ? 'rustfmt' : 'clippy'

    throw new ToolMissingError(
      `Rust is in the policy, but ${component} is not installed. Run "rustup component add ${component}".`
    )
  }

  return result
}

interface Span {
  file_name: string
  line_start: number
  column_start: number
  is_primary: boolean
  suggestion_applicability?: string | null
}

interface Diagnostic {
  message: string
  level: string
  code?: { code: string } | null
  spans: Span[]
  children?: Diagnostic[]
}

/** True when the compiler offers a fix it is sure of, which `cargo clippy --fix` applies. */
const machineFix = (diagnostic: Diagnostic): boolean =>
  [diagnostic, ...(diagnostic.children ?? [])].some(part =>
    part.spans.some(span => span.suggestion_applicability === 'MachineApplicable')
  )

/**
 * Turn Cargo's JSON messages into findings. A lint Clippy adds is `clippy:name`; a lint or an
 * error of the compiler is `rustc:name`. Cargo reports a file once for each target that builds
 * it, such as the library and its tests, so repeats are dropped.
 */
export const parseClippy = (root: string, cwd: string, stdout: string): { findings: Finding[]; failed: boolean } => {
  const findings = new Map<string, Finding>()
  let failed = false

  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue

    let message: { reason?: string; success?: boolean; message?: Diagnostic }

    try {
      message = JSON.parse(line) as typeof message
    } catch {
      continue
    }

    if (message.reason === 'build-finished') failed = message.success === false

    const diagnostic = message.message

    if (message.reason !== 'compiler-message' || !diagnostic) continue

    if (diagnostic.level !== 'warning' && diagnostic.level !== 'error') continue

    const spans = diagnostic.spans ?? []
    const span = spans.find(part => part.is_primary) ?? spans[0]
    const file = span ? fromEngine(root, cwd, span.file_name) : undefined

    // A summary such as "2 warnings emitted" has no place, and a dependency outside the repo is not the project's.
    if (!span || !file) continue

    const code = diagnostic.code?.code ?? (diagnostic.level === 'error' ? 'error' : 'warning')
    const clippy = code.startsWith('clippy::')
    const engineRule = clippy ? code.slice('clippy::'.length) : code
    const engine = clippy ? 'clippy' : 'rustc'
    const finding: Finding = {
      file,
      line: Math.max(1, span.line_start),
      column: Math.max(1, span.column_start),
      engine,
      engineRule,
      rule: `${engine}:${engineRule}`,
      severity: diagnostic.level === 'error' ? 'error' : 'warn',
      message: diagnostic.message,
      fixable: machineFix(diagnostic)
    }

    findings.set([file, finding.line, finding.column, finding.rule, finding.message].join('\0'), finding)
  }

  return { findings: [...findings.values()], failed }
}

const DIFF_HEADER = /^Diff in (.+?)(?::(\d+):| at line (\d+):)\s*$/

/**
 * Turn `cargo fmt -- --check --color never` into findings: one for each place rustfmt would
 * change, at the first line it changes. rustfmt prints a hunk that starts a few lines of context earlier.
 */
export const parseRustfmt = (root: string, cwd: string, stdout: string): Finding[] => {
  const findings: Finding[] = []
  const lines = stdout.split('\n')

  for (const [index, line] of lines.entries()) {
    const header = DIFF_HEADER.exec(line)

    if (!header) continue

    const file = fromEngine(root, cwd, header[1] as string)

    if (!file) continue

    const start = Number(header[2] ?? header[3])
    const hunk = lines.slice(index + 1)
    const end = hunk.findIndex(next => DIFF_HEADER.test(next))
    const context = (end === -1 ? hunk : hunk.slice(0, end)).findIndex(next => /^[-+]/.test(next))

    findings.push({
      file,
      line: Math.max(1, start + Math.max(0, context)),
      column: 1,
      engine: 'rustfmt',
      engineRule: 'format',
      rule: 'pawl/format',
      severity: 'error',
      message: 'Not formatted as rustfmt would format it.',
      fixable: true
    })
  }

  return findings
}

const CLIPPY_ARGS = ['clippy', '--workspace', '--all-targets', '--message-format=json']

/**
 * Lint a Rust project with Clippy. Clippy builds the code, so it runs on the whole Cargo
 * project and the findings are then narrowed to the files asked for.
 */
export const runClippy = async ({ root, dir, files, write = false }: LanguageRun): Promise<LanguageResult> => {
  const cwd = join(root, dir)
  const commands: string[] = []
  // Pawl's own fix runs on a working tree with changes in it, as the other engines' fixes do.
  const fixed = write
    ? await run(dir, root, [
        'clippy',
        '--fix',
        '--allow-dirty',
        '--allow-staged',
        '--allow-no-vcs',
        '--workspace',
        '--all-targets'
      ])
    : undefined

  if (fixed) commands.push(fixed.command.replace(' --allow-dirty --allow-staged --allow-no-vcs', ''))

  const result = await run(dir, root, CLIPPY_ARGS)
  const { findings, failed } = parseClippy(root, cwd, result.stdout)
  const errors = findings.some(finding => finding.severity === 'error')

  commands.push(result.command.replace(' --message-format=json', ''))

  // A failed build with no error to show means Cargo itself failed, such as a dependency it could not
  // fetch. Cargo can also stop before it builds anything, as on a manifest it cannot read: then it
  // prints no message at all, and only its exit code says so.
  if ((failed || result.code !== 0) && !errors) {
    throw new EngineError(result.stderr.trim() || `cargo clippy exited with code ${result.code}.`, {
      command: result.command
    })
  }

  // The fixes did not apply, though the code builds: say why, rather than report the code as fixed.
  if (fixed && fixed.code !== 0 && !errors) {
    throw new EngineError(fixed.stderr.trim() || `cargo clippy --fix exited with code ${fixed.code}.`, {
      command: fixed.command
    })
  }

  return { findings: onlyFiles(findings, dir, files), commands }
}

/** Check, or apply, rustfmt's formatting for a Rust project. */
export const runRustfmt = async ({ root, dir, files, write = false }: LanguageRun): Promise<LanguageResult> => {
  const commands: string[] = []

  if (write) {
    const formatted = await run(dir, root, ['fmt', '--all'])

    commands.push(formatted.command)

    if (formatted.code !== 0) {
      throw new EngineError(formatted.stderr.trim() || `cargo fmt exited with code ${formatted.code}.`, {
        command: formatted.command
      })
    }
  }

  const result = await run(dir, root, ['fmt', '--all', '--', '--check', '--color', 'never'])
  const findings = parseRustfmt(root, join(root, dir), result.stdout)

  commands.push(result.command.replace(' -- --check --color never', ' --check'))

  // rustfmt exits with 1 when it would change a file. Anything else, or 1 with no diff, is a failure.
  if (result.code !== 0 && findings.length === 0) {
    throw new EngineError(result.stderr.trim() || `cargo fmt exited with code ${result.code}.`, {
      command: result.command
    })
  }

  return { findings: onlyFiles(findings, dir, files), commands }
}
