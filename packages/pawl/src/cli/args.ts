/** The command line: the help text, the options, and reading and checking their values. */

import { type parseArgs } from 'node:util'
import { type OutputFormat } from '../check/output.ts'
import { VERSION } from '../version.ts'

export const HELP = `pawl ${VERSION}
Fast guardrails for AI-written code.

Usage
  pawl init             Set up this repo
  pawl check [files]    Lint, check formatting and apply the ratchet
  pawl fix [files]      Apply safe fixes and format
  pawl sync             Rewrite engine config files from the policy
  pawl add <pack...>    Switch on optional packs and install their ESLint plugins
  pawl migrate          Turn an existing ESLint config into a pawl policy, then set up
  pawl baseline         Accept the current findings as the baseline
  pawl explain <rule>   Show what a rule does and its level here
  pawl doctor           Check the setup and the tool versions

Options for check and fix
  --changed             Only files changed against HEAD, plus untracked ones
                        (every file outside a git repository)
  --since <ref>         Only files changed since the branch left <ref>, such as origin/main
  --format <kind>       pretty (default), agent or json
  --ci                  Also fail when the setup has drifted from the policy
  --max-warnings <n>    Fail when there are more than n new warnings
  --verbose             Show the engine commands that ran
  --hook                For a coding agent's post-edit hook: read the files it edited from
                        the hook's input, and answer in the shape that agent reads back

Options for doctor
  --format <kind>       pretty (default) or json

Options for init
  --mode <mode>         auto (default), keep or biome
  --engine <name>       The linter: biome, oxlint or eslint
  --formatter <name>    The formatter: biome or prettier
  --packs <a,b>         Optional packs to switch on
  --yes                 Accept the plan without asking (also for migrate)
  --dry-run             Show the plan and change nothing (also for add and migrate)
  --workflow            Add a GitHub Actions workflow
  --agents              Set up coding agents: hooks that fix each edit and report what is left
                        (Claude Code; Cursor, Codex and Copilot where the repo uses them),
                        instructions in AGENTS.md that Claude Code and Gemini CLI also read,
                        and a pawl skill
  --hooks               Add a pre-commit hook that checks changed files
  --no-editor           Skip editor settings
  --no-install          Do not run the package manager (also for add)

Options for migrate (it also takes the options for init)
  --keep-config         Write the policy and leave the ESLint config file alone
  --extends <policy>    Build on a policy package or file, and carry over only what differs from it

  -h, --help            Show this help
  -v, --version         Show the version
`

export const OPTIONS = {
  changed: { type: 'boolean' },
  since: { type: 'string' },
  format: { type: 'string' },
  ci: { type: 'boolean' },
  'max-warnings': { type: 'string' },
  verbose: { type: 'boolean' },
  hook: { type: 'boolean' },
  mode: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  'dry-run': { type: 'boolean' },
  workflow: { type: 'boolean' },
  agents: { type: 'boolean' },
  hooks: { type: 'boolean' },
  engine: { type: 'string' },
  formatter: { type: 'string' },
  packs: { type: 'string' },
  'no-editor': { type: 'boolean' },
  'no-install': { type: 'boolean' },
  'keep-config': { type: 'boolean' },
  extends: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' }
} as const

export type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values']

export class UsageError extends Error {}

export const outputFormat = (flags: Flags): OutputFormat => {
  const kind = flags.format ?? 'pretty'

  if (kind !== 'pretty' && kind !== 'agent' && kind !== 'json')
    throw new UsageError(`Unknown format "${kind}". Use pretty, agent or json.`)

  return kind
}

/** The value of --max-warnings: a whole number, zero or more. */
export const maxWarnings = (flags: Flags): number | undefined => {
  const value = flags['max-warnings']

  if (value === undefined) return undefined

  if (!/^\d+$/.test(value)) throw new UsageError(`--max-warnings takes a whole number, such as 0. Got "${value}".`)

  return Number(value)
}

/** The value of --since: a git ref, on its own, since it names the files to check. */
export const sinceRef = (flags: Flags, files: readonly string[]): string | undefined => {
  const ref = flags.since

  if (ref === undefined) return undefined

  if (ref.trim().length === 0) throw new UsageError('--since takes a git ref, such as origin/main.')

  if (flags.changed === true) throw new UsageError('Use --since or --changed, not both.')

  if (files.length > 0) throw new UsageError('Use --since or a list of files, not both.')

  return ref
}

/**
 * True when the `CI` environment variable says this is a CI run. Most services set it to `true`,
 * some to `1` or `True`; only an empty value, `0` and `false` mean no.
 */
export const inCi = (value: string | undefined): boolean =>
  value !== undefined && !['', '0', 'false'].includes(value.trim().toLowerCase())

/** The packs a comma-separated flag names, such as `--packs react,unicorn`. */
export const packList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)

/** "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`

/** A flag's value when it is one of `allowed`; a usage error otherwise. */
export const oneOf = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string
): T | undefined => {
  if (value === undefined) return undefined

  if (!allowed.includes(value as T)) throw new UsageError(`Unknown ${flag} "${value}". Use ${orList(allowed)}.`)

  return value as T
}

/**
 * Refuse what does not go with --hook: the hook's input names the files, and the agent reads
 * pawl's answer in its own shape.
 */
export const assertHookFlags = (flags: Flags, files: readonly string[]): void => {
  const clash = [
    files.length > 0 ? 'a list of files' : '',
    flags.changed === true ? '--changed' : '',
    flags.since === undefined ? '' : '--since',
    flags.format === undefined ? '' : '--format'
  ].filter(Boolean)

  if (clash.length > 0) {
    throw new UsageError(
      `--hook reads the files from the hook's input and answers in the agent's own shape. Leave out ${orList(clash)}.`
    )
  }
}
