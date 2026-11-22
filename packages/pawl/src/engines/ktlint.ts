import { join } from 'node:path'
import { type Finding } from '../types.ts'
import { commandIn, fromEngine, type LanguageResult, type LanguageRun, onlyFiles, ToolMissingError } from './cargo.ts'
import { EngineError, findOnPath, runProgram } from './run.ts'
import { chunked } from './swift.ts'

interface KtlintFile {
  file: string
  errors?: { line?: number; column?: number; message?: string; rule?: string }[]
}

/** Turn ktlint's JSON report into findings. ktlint's rules are about style, so each one is an error. */
export const parseKtlint = (root: string, cwd: string, stdout: string): Finding[] => {
  const start = stdout.indexOf('[')

  if (start === -1) return []

  const files = JSON.parse(stdout.slice(start)) as KtlintFile[]

  return files.flatMap(({ file: path, errors = [] }) => {
    const file = fromEngine(root, cwd, path)

    if (!file) return []

    return errors.map(error => {
      const engineRule = error.rule ?? 'ktlint'

      return {
        file,
        line: Math.max(1, error.line ?? 1),
        column: Math.max(1, error.column ?? 1),
        engine: 'ktlint',
        engineRule,
        rule: `ktlint:${engineRule}`,
        severity: 'error',
        message: error.message ?? engineRule,
        fixable: false
      } satisfies Finding
    })
  })
}

/**
 * Lint, and with `write` format, a Kotlin project with ktlint, in the project's .editorconfig.
 * ktlint is both the linter and the formatter, so one run does both.
 */
export const runKtlint = async ({ root, dir, files = [], write = false }: LanguageRun): Promise<LanguageResult> => {
  const program = findOnPath('ktlint')

  if (!program) throw new ToolMissingError('Kotlin is in the policy, but ktlint is not installed.')

  const cwd = join(root, dir)
  const findings: Finding[] = []
  const commands: string[] = []

  for (const batch of chunked(files)) {
    const args = [...(write ? ['--format'] : []), '--reporter=json', '--relative', ...batch]
    const result = await runProgram(program, args, cwd, commandIn(dir, `ktlint${write ? ' --format' : ''}`))

    if (!commands.includes(result.command)) commands.push(result.command)

    // ktlint exits with 1 when it finds something, with a report. Anything else is a failure.
    try {
      if (result.code > 1 || (result.code === 1 && !result.stdout.includes('['))) throw new Error('no report')

      findings.push(...parseKtlint(root, cwd, result.stdout))
    } catch (cause) {
      throw new EngineError(result.stderr.trim() || `ktlint exited with code ${result.code}.`, {
        command: result.command,
        cause
      })
    }
  }

  return { findings: onlyFiles(findings, dir, files), commands }
}
