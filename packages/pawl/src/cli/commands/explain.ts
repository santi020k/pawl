/** `pawl explain`: what a rule does and the level it has in this repo. */

import { EXIT_FINDINGS, EXIT_OK } from '../../check/result.ts'
import { loadPolicy } from '../../policy/load.ts'
import { explainRule } from '../../report/explain.ts'
import { UsageError } from '../args.ts'
import { type Terminal, terminal } from '../audience.ts'
import { out } from '../io.ts'

const FIELD = /^( {2})([A-Z][\w ]*:)( +)(.*)$/

const URL = /https?:\/\/\S+/g

/**
 * The explanation for a person: the rule's name stands out, the labels step back, the level
 * has its color, and links are underlined. The words are the plain ones, line for line.
 */
export const styleExplanation = (lines: readonly string[], { style, sym }: Terminal): string[] =>
  lines.map((line, index) => {
    if (index === 0) return style.bold(style.accent(line))

    const links = (text: string): string => text.replace(URL, link => style.underline(style.cyan(link)))
    const field = FIELD.exec(line)

    if (field) {
      const [, indent = '', label = '', gap = '', value = ''] = field
      const level = label === 'Level here:' ? /^(error|warn|off)\b/.exec(value)?.[1] : undefined
      const paints: Record<string, (text: string) => string> = { error: style.red, warn: style.yellow }
      const paint = paints[level ?? ''] ?? style.dim
      const shown = level ? `${paint(level)}${links(value.slice(level.length))}` : links(value)

      return `${indent}${style.dim(label)}${gap}${shown}`
    }

    if (line.startsWith('    - ')) return `    ${style.accent(sym.dot)} ${links(line.slice(6))}`

    return links(line)
  })

export const runExplain = async (root: string, query: string | undefined): Promise<number> => {
  if (!query) throw new UsageError('Which rule? For example: pawl explain no-console')

  const lines = explainRule(await loadPolicy(root), query, root)
  const term = terminal()

  if (!lines) {
    const text = `"${query}" is not in the pawl catalog. If it is an engine rule, see that engine's documentation.`

    out(term.rich ? `${term.style.yellow(term.sym.warning)} ${text}` : text)

    return EXIT_FINDINGS
  }

  out((term.rich ? styleExplanation(lines, term) : lines).join('\n'))

  return EXIT_OK
}
