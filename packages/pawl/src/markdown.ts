import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from './fs-utils.ts'
import { ignoreMatcher } from './ignores.ts'
import { type Finding, type Level, type Policy } from './types.ts'

/**
 * Pawl's own checks for Markdown files.
 *
 * They follow the rules of the same names in @eslint/markdown, with a plain line scan instead of a parser.
 * Code blocks, code spans, HTML comments and front matter are skipped.
 */
export interface MarkdownRule {
  name: string
  level: Level
  summary: string
  advice: string
}

const rule = (name: string, level: Level, summary: string, advice: string): MarkdownRule => ({
  name: `pawl/${name}`,
  level,
  summary,
  advice
})

export const MARKDOWN_RULES: readonly MarkdownRule[] = [
  rule(
    'markdown-no-empty-links',
    'error',
    'A link has no destination.',
    'Add the URL the link points to, or remove the link.'
  ),
  rule(
    'markdown-no-duplicate-headings',
    'off',
    'A heading repeats an earlier heading.',
    'Give each heading its own text, so its anchor is unique.'
  ),
  rule(
    'markdown-no-missing-label-refs',
    'off',
    'A reference has no matching definition.',
    'Add a definition such as [label]: https://example.com, or escape the brackets.'
  )
]

const BY_NAME = new Map(MARKDOWN_RULES.map(def => [def.name, def]))

export const getMarkdownRule = (name: string): MarkdownRule | undefined => BY_NAME.get(name)

export const isMarkdownFile = (file: string): boolean => /\.(md|markdown)$/i.test(file)

type Report = (name: string, line: number, column: number, detail?: string) => void

/** Blank out a match, keeping the columns of everything after it. */
const blank = (text: string): string => ' '.repeat(text.length)

/** Blank out code spans: a run of backticks up to the next run of the same length. */
const maskCode = (line: string): string => line.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)

/** A label as CommonMark compares it: trimmed, whitespace collapsed, case folded. */
const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The lines of a document that hold prose, with code spans and HTML comments blanked out.
 * Lines in front matter and fenced code blocks come back as undefined.
 */
const proseLines = (text: string): (string | undefined)[] => {
  const lines = text.split(/\r?\n/)
  const prose: (string | undefined)[] = []
  let fence: string | undefined
  let comment = false
  let frontMatter = lines[0]?.trimEnd() === '---'

  for (const [index, raw] of lines.entries()) {
    if (frontMatter) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(raw)) frontMatter = false

      prose.push(undefined)

      continue
    }

    if (fence !== undefined) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(raw)?.[1]

      if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined

      prose.push(undefined)

      continue
    }

    const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1]

    if (open && !(open[0] === '`' && raw.slice(raw.indexOf(open) + open.length).includes('`'))) {
      fence = open
      prose.push(undefined)

      continue
    }

    // Blank out HTML comments, which can span lines.
    let line = ''
    let rest = raw

    while (rest.length > 0) {
      if (comment) {
        const end = rest.indexOf('-->')

        if (end === -1) {
          line += blank(rest)
          rest = ''
        } else {
          line += blank(rest.slice(0, end + 3))
          rest = rest.slice(end + 3)
          comment = false
        }
      } else {
        const start = rest.indexOf('<!--')

        if (start === -1) {
          line += rest
          rest = ''
        } else {
          line += rest.slice(0, start)
          rest = rest.slice(start)
          comment = true
        }
      }
    }

    prose.push(maskCode(line))
  }

  return prose
}

const EMPTY_LINK = /(?<![!\\])\[[^\]]*\]\(\s*(?:<\s*>|#)?\s*\)/g

const checkEmptyLinks = (prose: readonly (string | undefined)[], report: Report): void => {
  for (const [index, line] of prose.entries()) {
    if (line === undefined) continue

    for (const match of line.matchAll(EMPTY_LINK)) report('markdown-no-empty-links', index + 1, match.index + 1)
  }
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
/** A line that cannot be the text of a setext heading. */
const NOT_PARAGRAPH = /^\s*$|^ {0,3}(#{1,6}([ \t]|$)|>|[-*+][ \t]|\d+[.)][ \t]|\||<)|^( {4}|\t)/

const normalizeHeading = (text: string): string => text.trim().replace(/\s+/g, ' ')

/**
 * As @eslint/markdown does by default, a heading counts as a duplicate when any earlier heading in the
 * document has the same text, at any level. ATX and setext headings are both read.
 */
const checkDuplicateHeadings = (prose: readonly (string | undefined)[], report: Report): void => {
  const seen = new Set<string>()
  /** The first line of the paragraph above, which a setext underline turns into a heading. */
  let paragraph: { line: number; text: string } | undefined

  const heading = (text: string, line: number): void => {
    const key = normalizeHeading(text)

    if (key.length === 0) return

    if (seen.has(key)) report('markdown-no-duplicate-headings', line, 1, key)
    else seen.add(key)
  }

  for (const [index, line] of prose.entries()) {
    if (line === undefined) {
      paragraph = undefined

      continue
    }

    const atx = ATX.exec(line)

    if (atx) {
      // Drop the optional closing run of #s.
      heading((atx[2] ?? '').replace(/(^|[ \t]+)#+[ \t]*$/, ''), index + 1)
      paragraph = undefined
    } else if (SETEXT.test(line)) {
      // Under a paragraph it is an underline; on its own, "---" is a thematic break.
      if (paragraph) heading(paragraph.text, paragraph.line)

      paragraph = undefined
    } else if (NOT_PARAGRAPH.test(line)) paragraph = undefined
    else if (paragraph) paragraph.text += ` ${line}`
    else paragraph = { line: index + 1, text: line }
  }
}

const DEFINITION = /^\s*(?:>\s*)*\[((?:\\.|[^[\]\\])+)\]:/
const INLINE_LINK = /!?\[[^\]]*\]\([^)]*\)/g
const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/
const REFERENCE = /(?<!\\)\[((?:\\.|[^[\]\\])*)\](?:\[((?:\\.|[^[\]\\])*)\])?/g

/**
 * References in full, collapsed and shortcut form whose label has no definition in the file.
 * Inline links, task list boxes, GitHub alerts ([!NOTE]), footnotes ([^1]) and wiki links ([[page]]) are left alone,
 * and so are brackets right after a word or a colon, such as items[0] or a :::note[Title] directive.
 */
const checkMissingLabelRefs = (prose: readonly (string | undefined)[], report: Report): void => {
  const defined = new Set<string>()
  const references: { line: number; column: number; label: string }[] = []

  for (const [index, raw] of prose.entries()) {
    if (raw === undefined) continue

    const definition = DEFINITION.exec(raw)?.[1]

    if (definition !== undefined) {
      defined.add(normalizeLabel(definition))

      continue
    }

    // Twice, so a link around an image goes too.
    const line = raw
      .replace(INLINE_LINK, blank)
      .replace(INLINE_LINK, blank)
      .replace(TASK, (box, lead: string) => `${lead}${blank(box.slice(lead.length))}`)

    for (const match of line.matchAll(REFERENCE)) {
      const label = match[2] || match[1] || ''
      const before = line[match.index - 1] ?? ''
      const after = line[match.index + match[0].length]

      if (label.trim().length === 0 || /^[\^!]/.test(label) || /[[\w:]/.test(before) || after === ']' || after === '(')
        continue

      references.push({ line: index + 1, column: match.index + 1, label })
    }
  }

  for (const { line, column, label } of references) {
    if (!defined.has(normalizeLabel(label))) report('markdown-no-missing-label-refs', line, column, label.trim())
  }
}

export interface MarkdownOptions {
  root: string
  policy: Policy
  /** Only look at these files, relative to the root. */
  files?: readonly string[]
}

/** Check every Markdown file in the project. */
export const checkMarkdown = ({ root, policy, files }: MarkdownOptions): Finding[] => {
  const ignored = ignoreMatcher(root, policy)
  const findings: Finding[] = []

  for (const file of (files ?? listFiles(root)).filter(name => isMarkdownFile(name) && !ignored(name))) {
    const path = join(root, file)

    if (!existsSync(path)) continue

    const report: Report = (short, line, column, detail) => {
      const def = BY_NAME.get(`pawl/${short}`)

      if (!def) return

      const severity = policy.rules[def.name] ?? def.level

      if (severity === 'off') return

      findings.push({
        file,
        line,
        column,
        engine: 'pawl',
        engineRule: def.name,
        rule: def.name,
        severity,
        message: `${def.summary.replace(/\.$/, '')}${detail ? ` (${detail})` : ''}. ${def.advice}`,
        fixable: false
      })
    }
    const prose = proseLines(readFileSync(path, 'utf8'))

    checkEmptyLinks(prose, report)
    checkDuplicateHeadings(prose, report)
    checkMissingLabelRefs(prose, report)
  }

  return findings
}
