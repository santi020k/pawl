/**
 * The rail that guided commands such as `pawl init` draw for a person: a start, a step for each
 * thing that happened, notes, spinners for the slow parts, and an end.
 *
 *   ┌  pawl init
 *   │
 *   ◇  Detected
 *   │  TypeScript, pnpm
 *   │
 *   └  Done.
 *
 * Only for the rich view. Plain output, for agents and pipes, is printed by each command as is.
 */

import { type Terminal } from './audience.ts'

interface Writable {
  write: (text: string) => unknown
  isTTY?: boolean
}

/** Break plain text into lines of at most `width` columns, at spaces. A longer word keeps its own line. */
export const wrap = (text: string, width: number): string[] =>
  text.split('\n').flatMap(paragraph => {
    const lines: string[] = []
    let line = ''

    for (const word of paragraph.split(' ')) {
      if (line.length > 0 && line.length + 1 + word.length > width) {
        lines.push(line)
        line = word
      } else {
        line = line.length > 0 ? `${line} ${word}` : word
      }
    }

    lines.push(line)

    return lines
  })

export interface Spinner {
  /** Change the text while it spins. */
  update: (text: string) => void
  /** Stop, and leave a finished line in its place. */
  stop: (text: string, kind?: 'done' | 'warn' | 'error') => void
  /** Stop, and leave nothing behind. */
  clear: () => void
}

export interface Rail {
  start: (title: string) => void
  /** A step that is done: its title, then the lines under it. */
  step: (title: string, lines?: readonly string[]) => void
  info: (title: string, lines?: readonly string[]) => void
  /** Something to know or to do by hand. */
  note: (text: string) => void
  warn: (text: string) => void
  error: (text: string) => void
  /** Lines on the rail, with nothing in front. */
  lines: (lines: readonly string[]) => void
  spinner: (text: string) => Spinner
  end: (text: string) => void
}

const HIDE_CURSOR = '\u001B[?25l'

const SHOW_CURSOR = '\u001B[?25h'

const CLEAR_LINE = '\r\u001B[2K'

/**
 * A spinner on one line of a stream. Without animation it prints nothing until it stops, so a
 * log gets the outcome and not a hundred frames.
 */
export const spinner = (term: Terminal, stream: Writable, text: string, prefix = ''): Spinner => {
  const { style, sym } = term
  const started = Date.now()
  let label = text
  let frame = 0
  let timer: ReturnType<typeof setInterval> | undefined

  const elapsed = (): string => {
    const seconds = Math.floor((Date.now() - started) / 1000)

    return seconds >= 2 ? style.dim(` ${seconds}s`) : ''
  }

  const draw = (): void => {
    const glyph = style.accent(sym.spinner[frame % sym.spinner.length] ?? '')

    frame += 1
    stream.write(`${CLEAR_LINE}${prefix}${glyph}  ${label}${elapsed()}`)
  }

  const restore = (): void => {
    stream.write(SHOW_CURSOR)
  }

  // Ctrl+C while it spins ends the run, with the cursor given back and the shell's code for an interrupt.
  const interrupt = (): void => {
    restore()
    process.exit(130)
  }

  const halt = (): void => {
    if (timer === undefined) return

    clearInterval(timer)
    timer = undefined
    stream.write(CLEAR_LINE)
    restore()
    process.off('exit', restore)
    process.off('SIGINT', interrupt)
  }

  if (term.animate) {
    stream.write(HIDE_CURSOR)
    process.once('exit', restore)
    process.once('SIGINT', interrupt)
    draw()
    timer = setInterval(draw, 80)
    // A spinner never keeps the process alive by itself.
    timer.unref()
  }

  return {
    update: next => {
      label = next
    },
    stop: (final, kind = 'done') => {
      halt()

      const marks = { done: style.accent(sym.step), warn: style.yellow(sym.warning), error: style.red(sym.cross) }
      const mark = marks[kind]

      stream.write(`${prefix}${mark}  ${final}\n`)
    },
    clear: halt
  }
}

/** The rail, drawn on stdout. */
export const rail = (term: Terminal, stream: Writable = process.stdout): Rail => {
  const { style, sym } = term
  const bar = style.gray(sym.bar)
  const width = term.width - 4
  const print = (text: string): void => {
    stream.write(`${text}\n`)
  }
  const under = (lines: readonly string[]): void => {
    for (const line of lines) print(line.length > 0 ? `${bar}  ${line}` : bar)
  }
  const marked = (mark: string, text: string, paint: (text: string) => string = line => line): void => {
    const [first = '', ...rest] = wrap(text, width)

    print(bar)
    print(`${mark}  ${paint(first)}`)
    under(rest.map(paint))
  }

  return {
    start: title => {
      print(`${style.gray(sym.barStart)}  ${title}`)
    },
    step: (title, lines = []) => {
      print(bar)
      print(`${style.accent(sym.step)}  ${title}`)
      under(lines)
    },
    info: (title, lines = []) => {
      print(bar)
      print(`${style.cyan(sym.info)}  ${title}`)
      under(lines)
    },
    note: text => {
      marked(style.cyan(sym.info), text)
    },
    warn: text => {
      marked(style.yellow(sym.warning), text)
    },
    error: text => {
      marked(style.red(sym.cross), text, style.red)
    },
    lines: under,
    spinner: text => {
      print(bar)

      return spinner(term, stream, text)
    },
    end: text => {
      print(bar)
      print(`${style.gray(sym.barEnd)}  ${text}`)
      print('')
    }
  }
}
