/**
 * Who is reading: a person at a terminal, or a coding agent running pawl for its own work. A
 * person gets colors, symbols, spinners and questions. An agent gets the same facts in fewer
 * tokens, with no escapes, no animation and never a question, since nobody is there to answer it.
 */

import {
  colorLevel,
  createStyle,
  layoutWidth,
  type Style,
  type Symbols,
  symbols,
  unicodeSupported
} from '../utils/terminal.ts'

type Env = Readonly<Record<string, string | undefined>>

/** The cross-agent variables: `AGENT` is the agents.md proposal, `AI_AGENT` the one Vercel reads. */
const NAMED = ['AGENT', 'AI_AGENT'] as const

/**
 * The variables each agent sets on the commands it runs. Order matters where one agent sets
 * another's variable for compatibility: Amp sets `CLAUDECODE`, and Qwen Code is a fork of Gemini CLI.
 * `CURSOR_TRACE_ID` is left out: Cursor sets it in the terminals people type in too.
 */
const MARKERS: readonly (readonly [variable: string, agent: string])[] = [
  ['AMP_CURRENT_THREAD_ID', 'Amp'],
  ['CLAUDECODE', 'Claude Code'],
  ['CLAUDE_CODE_ENTRYPOINT', 'Claude Code'],
  ['CURSOR_AGENT', 'Cursor'],
  ['QWEN_CODE', 'Qwen Code'],
  ['GEMINI_CLI', 'Gemini CLI'],
  ['CODEX_SANDBOX', 'Codex'],
  ['CODEX_THREAD_ID', 'Codex'],
  ['CODEX_CI', 'Codex'],
  ['AUGMENT_AGENT', 'Augment'],
  ['CLINE_ACTIVE', 'Cline'],
  ['OPENCODE_CLIENT', 'OpenCode'],
  ['ANTIGRAVITY_AGENT', 'Antigravity']
]

const off = (value: string | undefined): boolean =>
  value === undefined || ['', '0', 'false', 'no'].includes(value.trim().toLowerCase())

/** The agent a variable names, or "an agent" when it only says yes. */
const named = (value: string): string => (value === '1' || value === 'true' ? 'an agent' : value)

/**
 * The coding agent running pawl, by the variables agents set on the commands they run, or
 * undefined for a person. `PAWL_AGENT=0` says it is a person, whatever else is set, as when someone
 * types a command in an agent's own shell; `PAWL_AGENT=1` says it is an agent.
 */
export const detectAgent = (env: Env = process.env): string | undefined => {
  const own = env.PAWL_AGENT

  if (own !== undefined) return off(own) ? undefined : named(own)

  for (const variable of NAMED) {
    const value = env[variable]

    if (value !== undefined && !off(value)) return named(value)
  }

  return MARKERS.find(([variable]) => !off(env[variable]))?.[1]
}

/** How pawl talks to whoever runs it, worked out once per run. */
export interface Terminal {
  /** The agent running pawl, or undefined for a person. */
  agent: string | undefined
  /**
   * The full view for a person: symbols, code frames, sections, and colors where they are allowed.
   * Off for agents, pipes and dumb terminals, which get plain text that is stable to parse.
   */
  rich: boolean
  /** Spinners and redrawn lines: a person watching a terminal, outside CI. */
  animate: boolean
  /** A person who can answer a question: both ends are a terminal, and this is not CI. */
  interactive: boolean
  style: Style
  sym: Symbols
  /** The columns to lay text out in. */
  width: number
}

interface Streams {
  stdin: { isTTY?: boolean }
  stdout: { isTTY?: boolean; columns?: number }
}

export const terminalFor = (
  env: Env = process.env,
  streams: Streams = process,
  platform: string = process.platform
): Terminal => {
  const agent = detectAgent(env)
  const ci = !off(env.CI)
  const tty = streams.stdout.isTTY === true
  const level = agent === undefined ? colorLevel(streams.stdout, env) : 0
  // A person who forces colors into a pipe, as some CI setups do, still gets the full view.
  const rich = agent === undefined && env.TERM !== 'dumb' && (tty || level > 0)
  const animate = rich && tty && !ci

  return {
    agent,
    rich,
    animate,
    interactive: animate && streams.stdin.isTTY === true,
    style: createStyle(level),
    sym: symbols(rich && unicodeSupported(env, platform)),
    width: layoutWidth(streams.stdout)
  }
}

let current: Terminal | undefined

/** The terminal of this run. */
export const terminal = (): Terminal => {
  current ??= terminalFor()

  return current
}
