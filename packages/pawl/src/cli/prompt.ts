/**
 * Questions for a person at a terminal, drawn on the rail of `ui.ts`. Without one, as in CI or
 * under a coding agent, nothing is asked and each question returns its default, so a run never
 * waits for an answer nobody can give.
 */

import { emitKeypressEvents } from 'node:readline'
import { truncate, visibleWidth } from '../utils/terminal.ts'
import { type Terminal, terminal } from './audience.ts'

export interface Choice<T> {
  value: T
  label: string
  hint?: string
}

/** The person cancelled a question with Escape or Ctrl+C. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled.')
  }
}

export const isInteractive = (): boolean => terminal().interactive

interface Key {
  name?: string
  ctrl?: boolean
}

type State = 'active' | 'done' | 'cancelled'

/**
 * Draw a question, redraw it on every key, and leave its answer in its place. `onKey` returns
 * true when the key answered the question.
 */
const ask = async <T>(
  render: (state: State) => string[],
  onKey: (key: Key) => boolean,
  answer: () => T
): Promise<T> => {
  const { stdin, stdout } = process
  let drawn = 0

  const draw = (state: State): void => {
    // Each line is kept to the terminal's width, so the count of lines to redraw stays right.
    const lines = render(state).map(line => truncate(line, (stdout.columns ?? 80) - 1))

    if (drawn > 0) stdout.write(`\u001B[${drawn}A\r\u001B[0J`)

    stdout.write(`${lines.join('\n')}\n`)
    drawn = lines.length
  }

  stdout.write('\u001B[?25l')
  draw('active')
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()

  return new Promise<T>((resolvePromise, reject) => {
    const done = (state: State): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('keypress', onPress)
      draw(state)
      stdout.write('\u001B[?25h')
    }

    const onPress = (_text: string, key: Key | undefined): void => {
      if (!key) return

      if (key.name === 'escape' || (key.ctrl === true && key.name === 'c')) {
        done('cancelled')
        reject(new CancelledError())

        return
      }

      if (onKey(key)) {
        done('done')
        resolvePromise(answer())

        return
      }

      draw('active')
    }

    stdin.on('keypress', onPress)
  })
}

/** The first lines of a question: the rail, then its mark and text. */
const header = (term: Terminal, question: string, state: State, extra = ''): string[] => {
  const { style, sym } = term
  const marks: Record<State, string> = {
    active: style.cyan(sym.active),
    cancelled: style.red(sym.cancelled),
    done: style.accent(sym.step)
  }
  const mark = marks[state]

  return [style.gray(sym.bar), `${mark}  ${question}${state === 'active' ? extra : ''}`]
}

/** What follows an answered or cancelled question: the answer, dim, on the rail. */
const footer = (term: Terminal, state: State, answer: string): string[] => {
  const { style, sym } = term
  const bar = style.gray(sym.bar)

  return [`${bar}  ${state === 'cancelled' ? style.dim(style.italic('Cancelled')) : style.dim(answer)}`]
}

/** The hint after a label, cut to fit the line. */
const hintFor = (term: Terminal, hint: string | undefined, used: number): string =>
  hint ? term.style.dim(truncate(hint, Math.max(10, term.width - used - 4), term.sym.ellipsis)) : ''

/**
 * Ask the person to pick one option with the arrow keys.
 * Without a terminal, such as in CI or under a coding agent, the first choice is returned.
 */
export const select = async <T>(question: string, choices: readonly Choice<T>[]): Promise<T> => {
  const first = choices[0]

  if (!first) throw new Error('select() needs at least one choice.')

  const term = terminal()

  if (!term.interactive) return first.value

  const { style, sym } = term
  const width = Math.max(...choices.map(choice => visibleWidth(choice.label)))
  let index = 0

  const render = (state: State): string[] => {
    if (state !== 'active')
      return [...header(term, question, state), ...footer(term, state, choices[index]?.label ?? '')]

    return [
      ...header(term, question, state),
      ...choices.map((choice, position) => {
        const active = position === index
        const radio = active ? style.accent(sym.radioOn) : style.dim(sym.radioOff)
        const label = active ? style.bold(choice.label.padEnd(width)) : style.dim(choice.label.padEnd(width))

        return `${style.cyan(sym.bar)}  ${radio} ${label}  ${hintFor(term, choice.hint, width + 6)}`.trimEnd()
      }),
      style.cyan(sym.barEnd)
    ]
  }

  return ask(
    render,
    key => {
      if (key.name === 'up' || key.name === 'k') index = (index - 1 + choices.length) % choices.length
      else if (key.name === 'down' || key.name === 'j') index = (index + 1) % choices.length

      return key.name === 'return' || key.name === 'enter'
    },
    () => (choices[index] as Choice<T>).value
  )
}

/**
 * Ask the person to pick any number of options: space switches one, `a` switches all, Enter
 * accepts. Without a terminal the choices in `initial` are returned.
 */
export const multiselect = async <T>(
  question: string,
  choices: readonly Choice<T>[],
  initial: readonly T[] = []
): Promise<T[]> => {
  const term = terminal()

  if (!term.interactive) return [...initial]

  const { style, sym } = term
  const width = Math.max(...choices.map(choice => visibleWidth(choice.label)))
  const picked = new Set(initial)
  let index = 0
  const chosen = (): T[] => choices.filter(choice => picked.has(choice.value)).map(choice => choice.value)

  const render = (state: State): string[] => {
    if (state !== 'active') {
      const labels = choices.filter(choice => picked.has(choice.value)).map(choice => choice.label)

      return [...header(term, question, state), ...footer(term, state, labels.join(', ') || 'None')]
    }

    return [
      ...header(term, question, state, style.dim('  space to switch, enter to accept')),
      ...choices.map((choice, position) => {
        const on = picked.has(choice.value)
        const box = on ? style.accent(sym.boxOn) : style.dim(sym.boxOff)
        const text = choice.label.padEnd(width)
        const shown = on ? text : style.dim(text)
        const label = position === index ? style.bold(text) : shown

        return `${style.cyan(sym.bar)}  ${box} ${label}  ${hintFor(term, choice.hint, width + 6)}`.trimEnd()
      }),
      style.cyan(sym.barEnd)
    ]
  }

  return ask(
    render,
    key => {
      const choice = choices[index]

      if (key.name === 'up' || key.name === 'k') index = (index - 1 + choices.length) % choices.length
      else if (key.name === 'down' || key.name === 'j') index = (index + 1) % choices.length
      else if (key.name === 'space' && choice) {
        if (picked.has(choice.value)) picked.delete(choice.value)
        else picked.add(choice.value)
      } else if (key.name === 'a') {
        const all = picked.size === choices.length

        picked.clear()

        if (!all) for (const each of choices) picked.add(each.value)
      }

      return key.name === 'return' || key.name === 'enter'
    },
    chosen
  )
}

/** Ask a yes or no question. Without a terminal the default is returned. */
export const confirm = async (question: string, fallback = true): Promise<boolean> => {
  const term = terminal()

  if (!term.interactive) return fallback

  const { style, sym } = term
  let yes = fallback

  const render = (state: State): string[] => {
    if (state !== 'active') return [...header(term, question, state), ...footer(term, state, yes ? 'Yes' : 'No')]

    const option = (on: boolean, label: string): string =>
      on ? `${style.accent(sym.radioOn)} ${label}` : style.dim(`${sym.radioOff} ${label}`)

    return [
      ...header(term, question, state),
      `${style.cyan(sym.bar)}  ${option(yes, 'Yes')} ${style.dim('/')} ${option(!yes, 'No')}`,
      style.cyan(sym.barEnd)
    ]
  }

  return ask(
    render,
    key => {
      if (['left', 'right', 'up', 'down', 'tab', 'h', 'l'].includes(key.name ?? '')) yes = !yes
      else if (key.name === 'y') yes = true
      else if (key.name === 'n') yes = false

      return key.name === 'return' || key.name === 'enter' || key.name === 'y' || key.name === 'n'
    },
    () => yes
  )
}
