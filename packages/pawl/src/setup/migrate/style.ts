/** The formatting style an ESLint config and a Prettier config ask for, as the policy's `style`. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expandBraces, makeIgnore } from '../../project/ignores.ts'
import { type StyleOptions } from '../../types.ts'
import { readJson, readJsonc } from '../../utils/json.ts'
import { first, type RuleMap } from './read.ts'

export interface PrettierOptions {
  singleQuote?: boolean
  semi?: boolean
  tabWidth?: number
  useTabs?: boolean
  printWidth?: number
  trailingComma?: string
  arrowParens?: string
}

const isOptions = (value: unknown): value is PrettierOptions =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The Prettier options of a project, when its config is one pawl can read: JSON, in a file or in package.json. */
export const readPrettier = (root: string): PrettierOptions | undefined =>
  [
    readJsonc<unknown>(join(root, '.prettierrc')).value,
    readJsonc<unknown>(join(root, '.prettierrc.json')).value,
    readJson<{ prettier?: unknown }>(join(root, 'package.json'))?.prettier
  ].find(isOptions)

/** The widest line Biome formats to. */
const WIDEST_LINE = 320

/**
 * The options Prettier takes from the root .editorconfig for the project's scripts, as Prettier's CLI
 * reads them for an option its own config leaves out. Later sections win, as in EditorConfig.
 */
export const readEditorconfig = (root: string): PrettierOptions => {
  let text: string

  try {
    text = readFileSync(join(root, '.editorconfig'), 'utf8')
  } catch {
    return {}
  }

  const scripts = ['src/index.ts', 'src/index.js']
  const values: Record<string, string> = {}
  let applies = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()

    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue

    const section = /^\[(.*)\]$/.exec(line)

    if (section) {
      const matches = makeIgnore(expandBraces(section[1] ?? ''))

      applies = scripts.some(matches)
    } else if (applies) {
      const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line)

      if (pair?.[1] && pair[2] !== undefined) values[pair[1].toLowerCase()] = pair[2].toLowerCase()
    }
  }

  // What the EditorConfig parser Prettier uses fills in, as the EditorConfig spec says: a tab
  // indent has the tab's width, and one of the two widths stands for the other.
  if (values.indent_style === 'tab' && values.indent_size === undefined) values.indent_size = 'tab'

  if (values.indent_size !== undefined && values.indent_size !== 'tab' && values.tab_width === undefined) {
    values.tab_width = values.indent_size
  }

  if (values.indent_size === 'tab' && values.tab_width !== undefined) values.indent_size = values.tab_width

  // The same reading as Prettier's own, in src/config/editorconfig/editorconfig-to-prettier.js.
  const size = (value: string | undefined): number | undefined =>
    value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : undefined
  const options: PrettierOptions = {}

  if (values.indent_style === 'space') options.useTabs = false
  else if (values.indent_style === 'tab' || values.indent_size === 'tab') options.useTabs = true

  const width =
    options.useTabs === false ? (size(values.indent_size) ?? size(values.tab_width)) : size(values.tab_width)

  if (width !== undefined) options.tabWidth = width

  // `off` is no limit at all. The widest a style can be is the widest Biome formats to.
  const lineWidth = values.max_line_length === 'off' ? WIDEST_LINE : size(values.max_line_length)

  if (lineWidth !== undefined) options.printWidth = lineWidth

  if (values.quote_type === 'single' || values.quote_type === 'double') {
    options.singleQuote = values.quote_type === 'single'
  }

  return options
}

/**
 * What Prettier does with an option its config leaves out. A project with a Prettier config is
 * formatted this way already, so these are part of its style as much as the options it wrote down.
 */
const PRETTIER_DEFAULTS = {
  singleQuote: false,
  semi: true,
  tabWidth: 2,
  useTabs: false,
  printWidth: 80,
  trailingComma: 'all',
  arrowParens: 'always'
} satisfies Required<PrettierOptions>

const indentOf = (value: unknown): StyleOptions['indent'] | undefined => {
  if (value === 'tab') return 'tab'

  return value === 2 || value === 4 ? value : undefined
}

const commasOf = (value: unknown): StyleOptions['trailingCommas'] | undefined => {
  const setting = typeof value === 'object' && value !== null ? (value as { arrays?: unknown }).arrays : value

  if (typeof setting !== 'string') return undefined

  return setting === 'never' || setting === 'none' ? 'none' : 'all'
}

/**
 * Read the formatting style out of the old formatting rules, then out of a Prettier config when
 * there is one. `base` is the style the policy starts from.
 */
export const styleFrom = (
  formatting: RuleMap,
  prettier: PrettierOptions | undefined,
  base: StyleOptions
): Partial<StyleOptions> => {
  const style: { [Key in keyof StyleOptions]?: StyleOptions[Key] | undefined } = {}
  const option = (short: string): unknown => first(formatting, short)?.options[0]
  const quotes = option('quotes')
  const semi = first(formatting, 'semi')
  const maxLen = option('max-len')
  const arrow = option('arrow-parens')

  if (quotes === 'single' || quotes === 'double') style.quotes = quotes

  if (semi) style.semicolons = semi.options[0] !== 'never'

  style.indent = indentOf(option('indent'))
  style.trailingCommas = commasOf(option('comma-dangle'))
  style.lineWidth = typeof maxLen === 'number' ? maxLen : (maxLen as { code?: number } | undefined)?.code

  if (arrow === 'as-needed' || arrow === 'always') style.arrowParens = arrow

  // Prettier formats the code, so its options decide, the ones it defaults to included.
  if (prettier) {
    const set = { ...PRETTIER_DEFAULTS, ...prettier }

    style.quotes = set.singleQuote ? 'single' : 'double'
    style.semicolons = set.semi
    style.indent = set.useTabs ? 'tab' : (indentOf(set.tabWidth) ?? style.indent)
    style.trailingCommas = commasOf(set.trailingComma) ?? style.trailingCommas
    style.lineWidth = typeof set.printWidth === 'number' ? set.printWidth : style.lineWidth
    style.arrowParens = set.arrowParens === 'avoid' ? 'as-needed' : 'always'
  }

  // A wider line than Biome formats to means no limit in practice, and the policy refuses one.
  if (style.lineWidth !== undefined) style.lineWidth = Math.min(style.lineWidth, WIDEST_LINE)

  // Only what differs from what the policy starts from is worth writing down.
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => value !== undefined && value !== base[key as keyof StyleOptions])
  ) as Partial<StyleOptions>
}
