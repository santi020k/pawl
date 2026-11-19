import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'

export interface Choice<T> {
  value: T
  label: string
  hint?: string
}

export const isInteractive = (): boolean => process.stdin.isTTY === true && process.stdout.isTTY === true

/**
 * Ask the user to pick one option with the arrow keys.
 * Without a terminal, such as in CI or under a coding agent, the first choice is returned.
 */
export const select = async <T>(question: string, choices: readonly Choice<T>[]): Promise<T> => {
  const first = choices[0]

  if (!first) throw new Error('select() needs at least one choice.')

  if (!isInteractive()) return first.value

  const { stdin, stdout } = process
  const width = Math.max(...choices.map(choice => choice.label.length))
  let index = 0

  const render = (redraw: boolean): void => {
    if (redraw) stdout.write(`\u001B[${choices.length}A`)

    for (const [position, choice] of choices.entries()) {
      const active = position === index
      const label = choice.label.padEnd(width)
      const line = `${active ? '\u001B[36m❯\u001B[0m' : ' '} ${active ? `\u001B[1m${label}\u001B[0m` : label}  \u001B[2m${choice.hint ?? ''}\u001B[0m`

      stdout.write(`\u001B[2K${line}\n`)
    }
  }

  stdout.write(`\u001B[1m?\u001B[0m ${question}\n`)
  render(false)
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()

  return new Promise<T>((resolvePromise, reject) => {
    const done = (): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('keypress', onKey)
    }

    const onKey = (_text: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.name === 'up' || key.name === 'k') index = (index - 1 + choices.length) % choices.length
      else if (key.name === 'down' || key.name === 'j') index = (index + 1) % choices.length
      else if (key.name === 'return') {
        done()
        resolvePromise((choices[index] as Choice<T>).value)

        return
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        done()
        reject(new Error('Cancelled.'))

        return
      }

      render(true)
    }

    stdin.on('keypress', onKey)
  })
}

/** Ask a yes or no question. Without a terminal the default is returned. */
export const confirm = async (question: string, fallback = true): Promise<boolean> => {
  if (!isInteractive()) return fallback

  const readline = createInterface({ input: process.stdin, output: process.stdout })

  try {
    const answer = (await readline.question(`\u001B[1m?\u001B[0m ${question} ${fallback ? '(Y/n)' : '(y/N)'} `))
      .trim()
      .toLowerCase()

    return answer === '' ? fallback : answer === 'y' || answer === 'yes'
  } finally {
    readline.close()
  }
}
