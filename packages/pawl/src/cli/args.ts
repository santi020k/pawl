/** The command line: the help text, the options, and reading and checking their values. */

import { type parseArgs } from 'node:util'
import { OUTPUT_FORMATS, type OutputFormat } from '../check/output.ts'
import { type Style } from '../utils/terminal.ts'
import { closest } from '../utils/text.ts'
import { VERSION } from '../version.ts'

interface HelpRow {
  term: string
  /** One line per line of the help. */
  text: readonly string[]
}

interface HelpSection {
  title: string
  /** The commands the section is about. Empty means every command. */
  commands: readonly string[]
  rows: readonly HelpRow[]
}

const row = (term: string, ...text: string[]): HelpRow => ({ term, text })

/** Every command, with its arguments, and what it does. */
const COMMAND_ROWS: readonly HelpRow[] = [
  row('init', 'Set up this repo'),
  row('check [files]', 'Lint, check formatting and apply the ratchet'),
  row('fix [files]', 'Apply safe fixes and format'),
  row('sync', 'Rewrite engine config files from the policy'),
  row('add <pack...>', 'Switch on optional packs and install their ESLint plugins'),
  row('migrate', 'Turn an existing ESLint config into a pawl policy, then set up'),
  row('baseline', 'Accept the current findings as the baseline'),
  row('explain <rule>', 'Show what a rule does and its level here'),
  row('doctor', 'Check the setup and the tool versions')
]

const SECTIONS: readonly HelpSection[] = [
  {
    title: 'Options for check and fix',
    commands: ['check', 'fix'],
    rows: [
      row('--changed', 'Only files changed against HEAD, plus untracked ones', '(every file outside a git repository)'),
      row('--since <ref>', 'Only files changed since the branch left <ref>, such as origin/main'),
      row('--format <kind>', 'pretty, agent, editor or json (see Output below)'),
      row('--ci', 'Also fail when the setup has drifted from the policy'),
      row('--max-warnings <n>', 'Fail when there are more than n new warnings'),
      row('--verbose', 'Show the engine commands that ran'),
      row(
        '--hook',
        "For a coding agent's post-edit hook: read the files it edited from",
        "the hook's input, and answer in the shape that agent reads back"
      )
    ]
  },
  {
    title: 'Options for doctor',
    commands: ['doctor'],
    rows: [row('--format <kind>', 'pretty (default) or json')]
  },
  {
    title: 'Options for init',
    commands: ['init', 'migrate'],
    rows: [
      row('--mode <mode>', 'auto (default), keep or biome'),
      row('--engine <name>', 'The linter: biome, oxlint or eslint'),
      row('--formatter <name>', 'The formatter: biome or prettier'),
      row('--packs <a,b>', 'Optional packs to switch on'),
      row('--yes', 'Accept the plan without asking (also for migrate)'),
      row('--dry-run', 'Show the plan and change nothing (also for add and migrate)'),
      row('--workflow', 'Add a GitHub Actions workflow'),
      row(
        '--agents',
        'Set up coding agents: hooks that fix each edit and report what is left',
        '(Claude Code; Cursor, Codex and Copilot where the repo uses them),',
        'instructions in AGENTS.md that Claude Code and Gemini CLI also read,',
        'and a pawl skill'
      ),
      row('--hooks', 'Add a pre-commit hook that checks changed files'),
      row('--no-editor', 'Skip editor settings and tasks'),
      row('--no-install', 'Do not run the package manager (also for add)')
    ]
  },
  {
    title: 'Options for migrate (it also takes the options for init)',
    commands: ['migrate'],
    rows: [
      row('--keep-config', 'Write the policy and leave the ESLint config file alone'),
      row('--extends <policy>', 'Build on a policy package or file, and carry over only what differs from it')
    ]
  },
  {
    title: 'Output',
    commands: ['check', 'fix'],
    rows: [
      row('pretty', 'For people: each finding with its code and its fix. The default'),
      row(
        'agent',
        'For coding agents: one JSON line per finding, nothing when all is well.',
        'The default when a coding agent runs pawl'
      ),
      row(
        'editor',
        'For code editors: file:line:col: error: message [rule], the lines',
        'problem matchers, Vim and Emacs read'
      ),
      row('json', 'The whole result as one document, for CI and other tools'),
      row('PAWL_AGENT=0|1', 'Say whether a coding agent is running pawl, when the guess is wrong'),
      row('PAWL_FORMAT', 'The format when --format is not given, for programs that read pawl'),
      row('NO_COLOR', 'No colors. FORCE_COLOR=1 keeps them in a pipe')
    ]
  }
]

const GLOBAL_ROWS: readonly HelpRow[] = [row('-h, --help', 'Show this help'), row('-v, --version', 'Show the version')]

/** Runs to copy, for the help of one command. */
const EXAMPLES: Readonly<Record<string, readonly string[]>> = {
  init: ['pawl init', 'pawl init --yes --agents --hooks', 'pawl init --engine oxlint --formatter prettier'],
  check: ['pawl check', 'pawl check --changed', 'pawl check --since origin/main --ci', 'pawl check --format editor'],
  fix: ['pawl fix', 'pawl fix src/index.ts', 'pawl fix --changed'],
  add: ['pawl add react', 'pawl add react unicorn --dry-run'],
  migrate: ['pawl migrate --dry-run', 'pawl migrate --extends @acme/pawl-policy'],
  explain: ['pawl explain no-console', 'pawl explain biome:suspicious/noDebugger'],
  doctor: ['pawl doctor', 'pawl doctor --format json']
}

/** The names of the commands, as typed after `pawl`. */
export const COMMAND_NAMES: readonly string[] = COMMAND_ROWS.map(entry => entry.term.split(' ')[0] as string)

const TERM_WIDTH = 22

/**
 * The help, for every command or for one. With a style the help is drawn for a person, with
 * colors; without one it is plain text, laid out the same.
 */
export const helpText = (command?: string, style?: Style): string => {
  const paint = (paint: keyof Style, text: string): string =>
    style ? (style[paint] as (text: string) => string)(text) : text
  const known = command !== undefined && COMMAND_NAMES.includes(command)
  const rows = (entries: readonly HelpRow[], termPaint: keyof Style, prefix = ''): string[] =>
    entries.flatMap(({ term, text }) => {
      const [first = '', ...rest] = text
      const label = `${prefix}${term}`
      // A command's arguments step back from its name: "check" stands out, "[files]" does not.
      const space = term.indexOf(' ')
      const shown =
        termPaint === 'accent' && space > 0
          ? `${paint(termPaint, `${prefix}${term.slice(0, space)}`)}${paint('dim', term.slice(space))}`
          : paint(termPaint, label)

      return [
        `  ${shown}${' '.repeat(Math.max(2, TERM_WIDTH - label.length))}${first}`,
        ...rest.map(line => `${' '.repeat(TERM_WIDTH + 2)}${line}`)
      ]
    })
  const title = (text: string): string => paint('bold', text)
  const lines = style
    ? [`${style.accentBadge(' pawl ')} ${style.dim(VERSION)}`, 'Fast guardrails for AI-written code.', '']
    : [`pawl ${VERSION}`, 'Fast guardrails for AI-written code.', '']

  if (known) {
    const entry = COMMAND_ROWS.find(each => each.term.split(' ')[0] === command) as HelpRow

    lines.push(title('Usage'), `  ${paint('accent', `pawl ${entry.term}`)}  ${entry.text.join(' ')}`, '')
  } else if (style) {
    // A person gets the commands first, and the options of one command when they ask for it.
    lines.push(title('Usage'), `  pawl ${paint('accent', '<command>')} [options]`, '', title('Commands'))
    lines.push(...rows(COMMAND_ROWS, 'accent'), '')
  } else {
    lines.push(title('Usage'), ...rows(COMMAND_ROWS, 'accent', 'pawl '), '')
  }

  for (const section of SECTIONS) {
    if (known ? !section.commands.includes(command) : style !== undefined) continue

    lines.push(title(section.title), ...rows(section.rows, 'cyan'), '')
  }

  const examples = known ? EXAMPLES[command] : undefined

  if (examples) lines.push(title('Examples'), ...examples.map(example => `  ${paint('dim', '$')} ${example}`), '')

  if (style && !known) {
    lines.push(
      `Run ${paint('bold', 'pawl <command> --help')} for the options of a command. A coding agent that runs pawl`,
      `gets output made for it, and editors get ${paint('bold', '--format editor')}.`,
      ''
    )
  }

  lines.push(...(style ? [title('Options')] : []), ...rows(GLOBAL_ROWS, 'cyan'))

  if (style) lines.push('', `${style.dim('Docs')}  ${style.underline('https://pawl.santi020k.com')}`)

  return `${lines.join('\n')}\n`
}

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

/** The value of --format, or the default for whoever runs pawl when it is not given. */
export const outputFormat = (flags: Flags, fallback: OutputFormat = 'pretty'): OutputFormat => {
  const kind = flags.format ?? fallback

  if (!OUTPUT_FORMATS.includes(kind as OutputFormat)) {
    const near = closest(kind, OUTPUT_FORMATS)

    throw new UsageError(
      `Unknown format "${kind}". ${near ? `Did you mean "${near}"? ` : ''}Use ${orList(OUTPUT_FORMATS)}.`
    )
  }

  return kind as OutputFormat
}

/**
 * The format `PAWL_FORMAT` asks for, for a program that runs pawl and reads what it prints, such as
 * Quality, which sets it to `editor`. Undefined when it is not set. `--format` still wins.
 */
export const formatFromEnv = (env: Readonly<Record<string, string | undefined>>): OutputFormat | undefined => {
  const value = env.PAWL_FORMAT

  if (value === undefined || value.trim() === '') return undefined

  const kind = value.trim()

  if (!OUTPUT_FORMATS.includes(kind as OutputFormat))
    throw new UsageError(`PAWL_FORMAT is "${kind}". Use ${orList(OUTPUT_FORMATS)}.`)

  return kind as OutputFormat
}

/** A command name that is not one, with the command that was probably meant. */
export const unknownCommand = (command: string): UsageError => {
  const near = closest(command, COMMAND_NAMES)

  return new UsageError(
    `Unknown command "${command}".${near ? ` Did you mean "pawl ${near}"?` : ''} Run "pawl --help".`
  )
}

/**
 * The error of node:util's parseArgs, said as pawl says it, with the option that was probably
 * meant. Anything else is returned as it is.
 */
export const usageFrom = (error: unknown): unknown => {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : ''

  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const option = /'(-[^']*)'/.exec(message)?.[1] ?? ''
    const near = closest(
      option.replace(/^-+/, ''),
      Object.keys(OPTIONS).filter(name => !name.startsWith('no-') || option.startsWith('--no-'))
    )

    return new UsageError(
      `Unknown option "${option}".${near ? ` Did you mean "--${near}"?` : ''} Run "pawl --help" for the options.`
    )
  }

  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    const option = /'(--?[\w-]+)/.exec(message)?.[1]

    if (option && message.includes('argument missing')) return new UsageError(`${option} takes a value.`)

    return new UsageError(message)
  }

  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') return new UsageError(message)

  return error
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
