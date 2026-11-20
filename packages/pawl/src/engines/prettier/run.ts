import { type Finding } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'
import { EngineError, type EngineRun, type RunOptions, resolveBin, runNode, targets } from '../engine.ts'

const BIN = { packageName: 'prettier', bin: 'prettier', fallback: 'bin/prettier.cjs' }

/** Prettier is installed in the project. Pawl never brings its own. */
export const prettierInstalled = (root: string): boolean => resolveBin(root, BIN) !== undefined

/** Run the project's Prettier. Each file it would change is one formatting finding. */
export const runPrettier = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root, BIN)

  if (!bin) {
    throw new EngineError('Prettier is not installed in this project. Add it with your package manager.', {
      command: 'prettier'
    })
  }

  const shown = [write ? '--write' : '--list-different', ...targets(files)]
  const quiet = ['--ignore-unknown', '--no-error-on-unmatched-pattern']
  const result = await runNode(bin, [shown[0] as string, ...quiet, ...shown.slice(1)], root, 'prettier', shown)

  if (result.code > 1) {
    throw new EngineError(result.stderr.trim() || `Prettier exited with code ${result.code}.`, {
      command: result.command
    })
  }

  const findings: Finding[] = write
    ? []
    : result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(file => ({
          file: toPosix(file),
          line: 1,
          column: 1,
          engine: 'prettier' as const,
          engineRule: 'format',
          rule: 'pawl/format',
          severity: 'error' as const,
          message: 'File is not formatted.',
          fixable: true
        }))

  return { findings, command: result.command }
}
