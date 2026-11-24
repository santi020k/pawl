/** What a terminal can show: colors, symbols and the width of text. No pawl concepts. */

type Env = Readonly<Record<string, string | undefined>>

interface Stream {
  isTTY?: boolean
  columns?: number
}

/** 0: no color, 1: the 16 basic colors, 2: 256 colors, 3: true color. */
export type ColorLevel = 0 | 1 | 2 | 3

const TRUE_COLOR_TERMINALS = new Set(['iTerm.app', 'WezTerm', 'vscode', 'ghostty', 'zed'])

/**
 * How many colors a stream can show. `NO_COLOR` (when not empty) turns colors off, `FORCE_COLOR`
 * turns them on even without a terminal, and a dumb terminal or a pipe gets none.
 */
export const colorLevel = (stream: Stream, env: Env = process.env): ColorLevel => {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 0

  const force = env.FORCE_COLOR

  if (force !== undefined) {
    if (force === '0' || force === 'false') return 0

    if (force === '2' || force === '3') return Number(force) as ColorLevel

    if (stream.isTTY !== true) return 1
  }

  if (stream.isTTY !== true || env.TERM === 'dumb') return 0

  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 3

  if (TRUE_COLOR_TERMINALS.has(env.TERM_PROGRAM ?? '') || env.WT_SESSION !== undefined) return 3

  return (env.TERM ?? '').includes('256') ? 2 : 1
}

/**
 * True when the terminal draws box lines and symbols such as ✔. The Linux console and the old
 * Windows console do not; Windows Terminal, VS Code and the terminals of other editors do.
 */
export const unicodeSupported = (env: Env = process.env, platform: string = process.platform): boolean => {
  if (platform !== 'win32') return env.TERM !== 'linux'

  return (
    env.WT_SESSION !== undefined ||
    env.TERMINUS_SUBLIME !== undefined ||
    env.ConEmuTask === '{cmd::Cmder}' ||
    env.TERM_PROGRAM === 'vscode' ||
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' ||
    ['xterm-256color', 'alacritty', 'rxvt-unicode', 'rxvt-unicode-256color'].includes(env.TERM ?? '')
  )
}

const ESC = String.fromCharCode(27)

const BEL = String.fromCharCode(7)

/** The color and cursor escapes (CSI), and the escapes that end with BEL or ST, such as links (OSC). */
const ESCAPES = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g')

/** Text without its color and cursor escapes. */
export const stripAnsi = (text: string): string => text.replace(ESCAPES, '')

/** How many columns the text takes, leaving its escapes out. */
export const visibleWidth = (text: string): number => [...stripAnsi(text)].length

/** Pad text to a width by what shows, so colored text lines up with plain text. */
export const padVisible = (text: string, width: number): string =>
  `${text}${' '.repeat(Math.max(0, width - visibleWidth(text)))}`

/** The width to lay text out in: the terminal's, kept between 40 and 120 columns. */
export const layoutWidth = (stream: Stream): number => Math.min(120, Math.max(40, stream.columns ?? 80))

type Paint = (text: string) => string

export interface Style {
  readonly level: ColorLevel
  readonly bold: Paint
  readonly dim: Paint
  readonly italic: Paint
  readonly underline: Paint
  readonly red: Paint
  readonly green: Paint
  readonly yellow: Paint
  readonly blue: Paint
  readonly magenta: Paint
  readonly cyan: Paint
  readonly gray: Paint
  /** Pawl's signal lime. */
  readonly accent: Paint
  /** Dark text on lime, for pawl's name and a passing check. */
  readonly accentBadge: Paint
  readonly errorBadge: Paint
  readonly warnBadge: Paint
}

/**
 * The paints for a color level. Each one closes only what it opened, so a dim word inside a red
 * line keeps the rest of the line red. At level 0 every paint returns the text as it is.
 */
export const createStyle = (level: ColorLevel): Style => {
  const sgr =
    (open: string, close: string): Paint =>
    text =>
      level === 0 || text.length === 0 ? text : `\u001B[${open}m${text}\u001B[${close}m`
  // Lime #b5f23a, with near-black text on it: exact in true color, the nearest of 256, or bright green.
  const lime = { 0: '', 1: '92', 2: '38;5;155', 3: '38;2;181;242;58' }[level]
  const onLime = { 0: '', 1: '102;30', 2: '48;5;155;38;5;232', 3: '48;2;181;242;58;38;2;11;14;12' }[level]

  return {
    level,
    bold: sgr('1', '22'),
    dim: sgr('2', '22'),
    italic: sgr('3', '23'),
    underline: sgr('4', '24'),
    red: sgr('31', '39'),
    green: sgr('32', '39'),
    yellow: sgr('33', '39'),
    blue: sgr('34', '39'),
    magenta: sgr('35', '39'),
    cyan: sgr('36', '39'),
    gray: sgr('90', '39'),
    accent: sgr(lime, '39'),
    accentBadge: sgr(`1;${onLime}`, '22;39;49'),
    errorBadge: sgr('1;41;97', '22;39;49'),
    warnBadge: sgr('1;43;30', '22;39;49')
  }
}

export interface Symbols {
  readonly tick: string
  readonly cross: string
  readonly warning: string
  readonly info: string
  readonly arrow: string
  readonly pointer: string
  readonly dot: string
  readonly ellipsis: string
  /** The rail of a guided command such as `pawl init`. */
  readonly bar: string
  readonly barStart: string
  readonly barEnd: string
  readonly step: string
  readonly active: string
  readonly cancelled: string
  readonly radioOn: string
  readonly radioOff: string
  readonly boxOn: string
  readonly boxOff: string
  readonly spinner: readonly string[]
}

const UNICODE: Symbols = {
  tick: '✔',
  cross: '✖',
  warning: '▲',
  info: '●',
  arrow: '→',
  pointer: '❯',
  dot: '·',
  ellipsis: '…',
  bar: '│',
  barStart: '┌',
  barEnd: '└',
  step: '◇',
  active: '◆',
  cancelled: '■',
  radioOn: '●',
  radioOff: '○',
  boxOn: '◼',
  boxOff: '◻',
  spinner: ['◒', '◐', '◓', '◑']
}

const ASCII: Symbols = {
  tick: '√',
  cross: 'x',
  warning: '!',
  info: '*',
  arrow: '->',
  pointer: '>',
  dot: '-',
  ellipsis: '...',
  bar: '|',
  barStart: 'T',
  barEnd: '-',
  step: 'o',
  active: '*',
  cancelled: 'x',
  radioOn: '(*)',
  radioOff: '( )',
  boxOn: '[x]',
  boxOff: '[ ]',
  spinner: ['-', '\\', '|', '/']
}

export const symbols = (unicode: boolean): Symbols => (unicode ? UNICODE : ASCII)

/**
 * Keep text to a width, ending it with an ellipsis when it is cut. Escapes do not count toward the
 * width, and a cut colored text is reset after the cut so the color does not run on.
 */
export const truncate = (text: string, width: number, ellipsis = '…'): string => {
  if (visibleWidth(text) <= width) return text

  const keep = Math.max(0, width - [...ellipsis].length)
  const sequence = new RegExp(ESCAPES.source, 'y')
  let kept = ''
  let seen = 0
  let index = 0

  while (index < text.length && seen < keep) {
    sequence.lastIndex = index

    const match = sequence.exec(text)

    if (match) {
      kept += match[0]
      index += match[0].length
    } else {
      const char = String.fromCodePoint(text.codePointAt(index) ?? 0)

      kept += char
      index += char.length
      seen += 1
    }
  }

  return text === stripAnsi(text) ? `${kept}${ellipsis}` : `${kept}\u001B[0m${ellipsis}`
}
