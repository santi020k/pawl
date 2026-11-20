import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readJson, readJsonc, toPosix } from '../fs-utils.ts'
import { toEslintIgnores } from '../ignores.ts'
import { PRETTIER_CONFIG_FILES } from '../tools.ts'
import { type Finding, type Policy, type SetupIssue } from '../types.ts'
import { type EngineRun, type RunOptions } from './biome.ts'
import { EngineError, runChunked, runNode } from './run.ts'

/** The Prettier options that express the standard's style. */
export const prettierConfig = (policy: Policy): Record<string, string | number | boolean> => {
  const { style } = policy

  return {
    printWidth: style.lineWidth,
    useTabs: style.indent === 'tab',
    tabWidth: style.indent === 'tab' ? 2 : style.indent,
    semi: style.semicolons,
    singleQuote: style.quotes === 'single',
    trailingComma: style.trailingCommas,
    arrowParens: style.arrowParens === 'always' ? 'always' : 'avoid'
  }
}

export interface PrettierConfigCheck {
  status: 'ok' | 'missing' | 'stale' | 'unmanaged'
  file: string | undefined
  issue?: SetupIssue
}

/**
 * Compare the project's Prettier config with the standard's style.
 * Only JSON configs can be read; a config written in JavaScript is left to its owner.
 */
export const checkPrettierConfig = (root: string, policy: Policy): PrettierConfigCheck => {
  const file = PRETTIER_CONFIG_FILES.find(name => existsSync(join(root, name)))

  if (!file) {
    const inManifest = readJson<{ prettier?: unknown }>(join(root, 'package.json'))?.prettier !== undefined

    if (inManifest) return { status: 'unmanaged', file: 'package.json' }

    return {
      status: 'missing',
      file,
      issue: { code: 'prettier-config-missing', message: 'No Prettier config found.', fix: 'Run "pawl sync".' }
    }
  }

  if (file !== '.prettierrc' && file !== '.prettierrc.json') return { status: 'unmanaged', file }

  const { value } = readJsonc<Record<string, unknown>>(join(root, file))

  if (!value) return { status: 'unmanaged', file }

  const drifted = Object.entries(prettierConfig(policy)).filter(([key, expected]) => value[key] !== expected)

  if (drifted.length === 0) return { status: 'ok', file }

  return {
    status: 'stale',
    file,
    issue: {
      code: 'prettier-config-stale',
      message: `${file} differs from the standard's style (${drifted.map(([key]) => key).join(', ')}).`,
      fix: 'Run "pawl sync".'
    }
  }
}

const resolveBin = (root: string): string | undefined => {
  try {
    const manifestPath = createRequire(join(root, 'package.json')).resolve('prettier/package.json')
    const bin = readJson<{ bin?: string | Record<string, string> }>(manifestPath)?.bin
    const entry = typeof bin === 'string' ? bin : bin?.prettier

    return entry ? join(dirname(manifestPath), entry) : undefined
  } catch {
    return undefined
  }
}

export const prettierInstalled = (root: string): boolean => resolveBin(root) !== undefined

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

/** Run the project's Prettier. Each file it would change is one formatting finding. */
/**
 * Prettier's form of the patterns pawl skips: negative patterns on its command line, which it
 * applies to the folders it walks and to the files it is given. Prettier has no config for them,
 * and reads only .gitignore and .prettierignore by itself. A `!` pattern that takes a file back
 * cannot be said this way, so Prettier keeps skipping that file.
 */
export const prettierExclusions = (ignore: readonly string[]): string[] =>
  ignore
    .filter(pattern => !pattern.startsWith('!'))
    .flatMap(pattern => toEslintIgnores(pattern).map(glob => `!${glob}`))

export const runPrettier = async ({
  root,
  files,
  write = false,
  ignore = []
}: RunOptions & { ignore?: readonly string[] }): Promise<EngineRun> => {
  const bin = resolveBin(root)

  if (!bin)
    throw new EngineError('Prettier is not installed in this project. Add it with your package manager.', {
      command: 'prettier'
    })

  const mode = write ? '--write' : '--list-different'
  // With --no-error-on-unmatched-pattern, a file named and skipped is passed over in silence.
  const flags = [mode, '--ignore-unknown', '--no-error-on-unmatched-pattern', ...prettierExclusions(ignore)]

  return runChunked(files, `prettier ${mode}`, async targets => {
    const result = await runNode(bin, [...flags, ...targets], root, 'prettier')

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
  })
}
