import { listFiles } from '../../project/files.ts'
import { makeIgnore, toEslintIgnores } from '../../project/ignores.ts'
import { type Finding } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'
import { EngineError, type EngineRun, type RunOptions, resolveBin, runChunked, runNode } from '../engine.ts'

const BIN = { packageName: 'prettier', bin: 'prettier', fallback: 'bin/prettier.cjs' }

/** Prettier is installed in the project. Pawl never brings its own. */
export const prettierInstalled = (root: string): boolean => resolveBin(root, BIN) !== undefined

export interface PrettierParseErrors {
  /** One finding for each file Prettier could not parse. */
  findings: Finding[]
  /** True when every line of stderr belongs to the syntax error of a file that was checked. */
  complete: boolean
}

/** A terminal colour code, which starts with the escape character. */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** A code frame line of Prettier's error: `> 1 | code`, `  2 | code` or `    | ^`. */
const FRAME_LINE = /^\[error\]\s+(?:>\s*)?(?:\d+\s)?\|/

/** Prettier prints the file as it was given, relative to where it ran. */
const isChecked = (file: string, targets: readonly string[]): boolean => {
  const name = toPosix(file).replace(/^\.\//, '')

  if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) return false

  return targets.some(target => {
    const wanted = toPosix(target).replace(/^\.\//, '').replace(/\/$/, '')

    return wanted === '.' || wanted === '' || name === wanted || name.startsWith(`${wanted}/`)
  })
}

/**
 * Read what Prettier prints on stderr when a file does not parse: a line `[error] <file>: SyntaxError:
 * <message> (<line>:<column>)` and then a code frame. The run counts as complete only when every
 * line is part of such a block for a file that was checked. Any other line, a broken config, an
 * unknown option or a crash, leaves it incomplete, and the caller must treat the run as failed.
 */
export const parsePrettierErrors = (stderr: string, targets: readonly string[]): PrettierParseErrors => {
  const findings: Finding[] = []
  let complete = true
  let inBlock = false

  // Colour codes, in case a plugin forces them on: pawl asks Prettier for none.
  const plain = stderr.replace(COLOUR, '')

  for (const line of plain.split('\n').map(text => text.replace(/\r$/, ''))) {
    if (line.trim() === '') continue

    const header = /^\[error\] (.+?): (SyntaxError: .*)$/.exec(line)

    if (header?.[1] !== undefined && header[2] !== undefined && isChecked(header[1], targets)) {
      const message = header[2].trim()
      const position = /\((\d+):(\d+)\)$/.exec(message)

      findings.push({
        file: toPosix(header[1]).replace(/^\.\//, ''),
        line: Math.max(1, Number(position?.[1] ?? 1)),
        column: Math.max(1, Number(position?.[2] ?? 1)),
        engine: 'prettier',
        engineRule: 'parse',
        rule: 'prettier:parse',
        severity: 'error',
        message,
        fixable: false
      })
      inBlock = true
    } else if (!(inBlock && FRAME_LINE.test(line))) {
      complete = false
    }
  }

  return { findings, complete: complete && findings.length > 0 }
}

/**
 * Prettier's form of the patterns pawl skips: negative patterns on its command line, which it
 * applies to the folders it walks and to the files it is given. Prettier has no config for them,
 * and reads only .gitignore and .prettierignore by itself. A `!` pattern that takes a file back
 * cannot be said this way: takenBack finds those files, for a run of their own.
 */
export const prettierExclusions = (ignore: readonly string[]): string[] =>
  ignore
    .filter(pattern => !pattern.startsWith('!'))
    .flatMap(pattern => toEslintIgnores(pattern).map(glob => `!${glob}`))

/** One Prettier run over some targets, read into findings. */
const runWith =
  (root: string, bin: string, mode: string, flags: readonly string[], write: boolean) =>
  async (targets: readonly string[]): Promise<Finding[]> => {
    const result = await runNode(bin, [mode, ...flags, ...targets], root, 'prettier', [mode, ...targets])

    // A warning is about a config Prettier could still use, such as an unknown option, and the run
    // goes on. An error means a file, or the whole run, was not checked, whatever the exit code:
    // with a plugin it cannot load Prettier exits with 1, as if some files only needed formatting.
    const errors = result.stderr
      .split('\n')
      .filter(line => !line.startsWith('[warn]'))
      .join('\n')
    let unparsed: Finding[] = []

    if (result.code > 1 || errors.includes('[error]')) {
      // A file Prettier cannot parse is a finding on that file, and the run still lists the rest.
      const parsed = result.code <= 2 ? parsePrettierErrors(errors, targets) : undefined

      if (!parsed?.complete) {
        throw new EngineError(result.stderr.trim() || `Prettier exited with code ${result.code}.`, {
          command: result.command
        })
      }

      unparsed = parsed.findings
    }

    if (write) return unparsed

    const unformatted = result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(
        (file): Finding => ({
          file: toPosix(file),
          line: 1,
          column: 1,
          engine: 'prettier',
          engineRule: 'format',
          rule: 'pawl/format',
          severity: 'error',
          message: 'File is not formatted.',
          fixable: true
        })
      )

    return [...unparsed, ...unformatted]
  }

/**
 * The files a `!` pattern of the policy takes back that the negative patterns still skip, within
 * the files or folders the run is for. Prettier is given them by name, in a run without those
 * patterns, so a file pawl checks is never left out.
 */
const takenBack = (root: string, ignore: readonly string[], targets: readonly string[] | undefined): string[] => {
  if (!ignore.some(pattern => pattern.startsWith('!'))) return []

  const skippedByPrettier = makeIgnore(ignore.filter(pattern => !pattern.startsWith('!')))
  const skippedByPawl = makeIgnore(ignore)
  const named = (targets ?? []).map(target => target.replace(/\/+$/, ''))
  const within = (file: string): boolean =>
    named.length === 0 || named.some(target => target === '.' || file === target || file.startsWith(`${target}/`))

  return listFiles(root).filter(file => within(file) && skippedByPrettier(file) && !skippedByPawl(file))
}

/** Run the project's Prettier. Each file it would change is one formatting finding. */
export const runPrettier = async ({
  root,
  files,
  write = false,
  ignore = [],
  gitignore = true
}: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root, BIN)

  if (!bin) {
    throw new EngineError('Prettier is not installed in this project. Add it with your package manager.', {
      command: 'prettier'
    })
  }

  const mode = write ? '--write' : '--list-different'
  // With --no-error-on-unmatched-pattern, a file named and skipped is passed over in silence.
  const quiet = [
    '--ignore-unknown',
    '--no-error-on-unmatched-pattern',
    // Prettier reads .gitignore and .prettierignore by default. A policy that does not follow the
    // .gitignore names the other file alone.
    ...(gitignore ? [] : ['--ignore-path', '.prettierignore'])
  ]
  const back = takenBack(root, ignore, files)
  const main = await runChunked(
    files,
    `prettier ${mode}`,
    runWith(root, bin, mode, [...quiet, ...prettierExclusions(ignore)], write)
  )

  if (back.length === 0) return main

  const again = await runChunked(back, `prettier ${mode}`, runWith(root, bin, mode, quiet, write))

  return { findings: [...main.findings, ...again.findings], command: main.command }
}
