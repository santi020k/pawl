/**
 * The simple commands of a shell command line, read well enough to tell what each one runs and
 * which files it writes, in POSIX shells and PowerShell. It is no shell: it expands nothing.
 */

/** One simple command: its words with the quotes taken off, what it redirects to, and what it reads as input. */
export interface ShellCommand {
  words: string[]
  /** The files its output redirections write: `> file`, `>> file`, `&> file`. */
  writes: string[]
  /** The text of its here-documents and here-strings, which is data for the command, not commands. */
  input: string
}

/** How deep a command inside another one is read: `$(…)` within double quotes, `bash -c '…'`. */
const DEPTH = 3

/** Inside double quotes, a backslash escapes only these. */
const DOUBLE_QUOTED_ESCAPES = '"\\$`'

/** Outside quotes, a backslash escapes these. Before anything else it stays, as in a Windows path. */
const ESCAPES = ' \'"\\;&|<>()'

/** The words that end a simple command. */
const SEPARATORS = ';&|()`'

/** The options that hand a shell, npx or PowerShell a command line to run. */
const RUNS_LINE = /^(?:-c|--call|-command|\/c)$/i

const create = (): ShellCommand => ({ words: [], writes: [], input: '' })

/** Read a command line into its simple commands, those it runs inside them included. */
export const shellCommands = (line: string, depth = 0): ShellCommand[] => {
  const commands: ShellCommand[] = []
  const nested: string[] = []
  const heredocs: { delimiter: string; command: ShellCommand }[] = []
  let current = create()
  let word: string | undefined
  let role: 'word' | 'write' | 'read' | 'string' | 'heredoc' = 'word'

  const endWord = (): void => {
    if (word === undefined) return

    if (role === 'write') current.writes.push(word)
    else if (role === 'heredoc') heredocs.push({ delimiter: word, command: current })
    else if (role === 'string') current.input += `${word}\n`
    else if (role === 'word') current.words.push(word)

    word = undefined
    role = 'word'
  }
  const endCommand = (): void => {
    endWord()

    if (current.words.length > 0 || current.writes.length > 0 || heredocs.some(item => item.command === current))
      commands.push(current)

    current = create()
  }
  // A number right before a redirection is the stream it redirects, not a word.
  const dropStream = (): void => {
    if (word !== undefined && /^\d+$/.test(word)) word = undefined

    endWord()
  }
  // The lines after the one that opened here-documents are their text, up to each delimiter.
  const readHeredocs = (at: number): number => {
    let index = at

    for (const { delimiter, command } of heredocs.splice(0)) {
      const lines: string[] = []

      while (index < line.length) {
        const end = line.indexOf('\n', index + 1)
        const stop = end === -1 ? line.length : end
        const text = line.slice(index + 1, stop)

        index = stop

        if (text.trim() === delimiter) break

        lines.push(text)
      }

      command.input += `${lines.join('\n')}\n`
    }

    return index
  }

  for (let index = 0; index < line.length; index++) {
    const char = line[index] as string
    const next = line[index + 1] ?? ''

    if (char === "'") {
      const end = line.indexOf("'", index + 1)
      const stop = end === -1 ? line.length : end

      word = (word ?? '') + line.slice(index + 1, stop)
      index = stop
    } else if (char === '"') {
      let text = ''

      index++

      while (index < line.length && line[index] !== '"') {
        const escaped = line[index] === '\\' && DOUBLE_QUOTED_ESCAPES.includes(line[index + 1] ?? '')

        text += escaped ? line[index + 1] : line[index]
        index += escaped ? 2 : 1
      }

      // A command substitution runs, even inside double quotes.
      if (text.includes('$(') || text.includes('`')) nested.push(text)

      word = (word ?? '') + text
    } else if ((char === '\\' || char === '`') && next === '\n') {
      // A line continued on the next one, in a POSIX shell or in PowerShell.
      index++
    } else if (char === '\\' && ESCAPES.includes(next)) {
      word = (word ?? '') + next
      index++
    } else if (char === '#' && word === undefined) {
      const end = line.indexOf('\n', index)

      index = (end === -1 ? line.length : end) - 1
    } else if (char === ' ' || char === '\t' || char === '\r') {
      endWord()
    } else if (char === '\n') {
      endCommand()
      index = readHeredocs(index)
    } else if (char === '>' || (char === '&' && next === '>')) {
      dropStream()

      if (char === '&') index++

      while (line[index + 1] === '>' || line[index + 1] === '|') index++

      if (line[index + 1] === '(') {
        endCommand()
        index++
      } else if (line[index + 1] === '&') {
        index++

        if (/[\d-]/.test(line[index + 1] ?? '')) while (/[\d-]/.test(line[index + 1] ?? '')) index++
        else role = 'write'
      } else {
        role = 'write'
      }
    } else if (char === '<') {
      dropStream()

      if (next === '(') {
        endCommand()
        index++
      } else if (next === '<' && line[index + 2] === '<') {
        index += 2
        role = 'string'
      } else if (next === '<') {
        index += line[index + 2] === '-' ? 2 : 1
        role = 'heredoc'
      } else if (next === '>') {
        index++
        role = 'write'
      } else {
        role = 'read'
      }
    } else if (SEPARATORS.includes(char)) {
      endCommand()
    } else {
      word = (word ?? '') + char
    }
  }

  endCommand()

  if (depth >= DEPTH) return commands

  // What a command hands to a shell to run is commands too: `bash -c '…'`, `eval …`, `bash <<EOF`.
  const inner = commands.flatMap(command => {
    const lines = command.words.flatMap((item, index) =>
      RUNS_LINE.test(item) && command.words[index + 1] !== undefined ? [command.words[index + 1] as string] : []
    )
    const program = command.words[0]?.split(/[\\/]/).pop()?.toLowerCase() ?? ''

    if (program === 'eval' || program === 'invoke-expression' || program === 'iex')
      lines.push(command.words.slice(1).join(' '))

    if (/^(?:ba|z|da|k)?sh$/.test(program) && command.input) lines.push(command.input)

    return lines
  })

  return [...commands, ...[...nested, ...inner].flatMap(text => shellCommands(text, depth + 1))]
}
