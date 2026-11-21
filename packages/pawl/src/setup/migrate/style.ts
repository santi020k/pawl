/** The formatting style an ESLint config and a Prettier config ask for, as the policy's `style`. */

import { join } from 'node:path'
import { DEFAULT_STYLE } from '../../policy/merge.ts'
import { type StyleOptions } from '../../types.ts'
import { readJson } from '../../utils/json.ts'
import { first, type RuleMap } from './read.ts'

interface PrettierOptions {
  singleQuote?: boolean
  semi?: boolean
  tabWidth?: number
  useTabs?: boolean
  printWidth?: number
  trailingComma?: string
  arrowParens?: string
}

const readPrettier = (root: string): PrettierOptions | undefined =>
  readJson<PrettierOptions>(join(root, '.prettierrc')) ??
  readJson<PrettierOptions>(join(root, '.prettierrc.json')) ??
  readJson<{ prettier?: PrettierOptions }>(join(root, 'package.json'))?.prettier

const indentOf = (value: unknown): StyleOptions['indent'] | undefined => {
  if (value === 'tab') return 'tab'

  return value === 2 || value === 4 ? value : undefined
}

const commasOf = (value: unknown): StyleOptions['trailingCommas'] | undefined => {
  const setting = typeof value === 'object' && value !== null ? (value as { arrays?: unknown }).arrays : value

  if (typeof setting !== 'string') return undefined

  return setting === 'never' || setting === 'none' ? 'none' : 'all'
}

/** Read the formatting style out of the old formatting rules, then out of a Prettier config when there is one. */
export const styleFrom = (root: string, formatting: RuleMap): Partial<StyleOptions> => {
  const style: { [Key in keyof StyleOptions]?: StyleOptions[Key] | undefined } = {}
  const option = (short: string): unknown => first(formatting, short)?.options[0]
  const quotes = option('quotes')
  const semi = first(formatting, 'semi')
  const maxLen = option('max-len')
  const arrow = option('arrow-parens')
  const prettier = readPrettier(root)

  if (quotes === 'single' || quotes === 'double') style.quotes = quotes

  if (semi) style.semicolons = semi.options[0] !== 'never'

  style.indent = indentOf(option('indent'))
  style.trailingCommas = commasOf(option('comma-dangle'))
  style.lineWidth = typeof maxLen === 'number' ? maxLen : (maxLen as { code?: number } | undefined)?.code

  if (arrow === 'as-needed' || arrow === 'always') style.arrowParens = arrow

  if (prettier) {
    if (prettier.singleQuote !== undefined) style.quotes = prettier.singleQuote ? 'single' : 'double'

    if (prettier.semi !== undefined) style.semicolons = prettier.semi

    if (prettier.useTabs) style.indent = 'tab'
    else style.indent = indentOf(prettier.tabWidth) ?? style.indent

    style.trailingCommas = commasOf(prettier.trailingComma) ?? style.trailingCommas
    style.lineWidth = prettier.printWidth ?? style.lineWidth

    if (prettier.arrowParens === 'always') style.arrowParens = 'always'
    else if (prettier.arrowParens === 'avoid') style.arrowParens = 'as-needed'
  }

  // Only what differs from the standard is worth writing down.
  return Object.fromEntries(
    Object.entries(style).filter(
      ([key, value]) => value !== undefined && value !== DEFAULT_STYLE[key as keyof StyleOptions]
    )
  ) as Partial<StyleOptions>
}
