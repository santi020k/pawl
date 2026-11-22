import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from '../project/files.ts'
import { type Finding, type SetupIssue } from '../types.ts'
import { readJson, sortKeys, writeJson } from '../utils/json.ts'

export const BASELINE_FILE = '.pawl/baseline.json'

/**
 * Findings the project already had when it adopted the standard.
 *
 * Counts are kept per file and rule, not per line, so the file survives edits and merges.
 */
export interface Baseline {
  version: 1
  findings: Record<string, Record<string, number>>
  /** Comments that switch a check off, counted per file. */
  suppressions: Record<string, number>
}

export interface Suppression {
  file: string
  line: number
  text: string
}

/** The words that switch a check off, in a comment of Biome, ESLint, Oxlint or TypeScript. */
const DIRECTIVE =
  'biome-ignore(?:-all|-start)?|eslint-disable(?:-next-line|-line)?|oxlint-disable(?:-next-line|-line)?|@ts-ignore|@ts-expect-error|@ts-nocheck'

const SLASH_COMMENT = new RegExp(`(?:\\/\\/|\\/\\*|\\*|<!--)\\s*(${DIRECTIVE})\\b`)

/**
 * The files a linter reads, by how each writes a comment. Markdown is left out on purpose:
 * its code blocks show such comments far more often than they mean them.
 */
const COMMENTS: readonly [RegExp, RegExp][] = [
  // Scripts and components, then the stylesheets and JSON files Biome lints.
  [/\.(?:[cm]?[jt]sx?|vue|svelte|astro|css|jsonc?)$/, SLASH_COMMENT],
  // GraphQL, which Biome lints, and the YAML and TOML files an ESLint pack lints.
  [/\.(?:graphql|gql|ya?ml|toml)$/, new RegExp(`#\\s*(${DIRECTIVE})\\b`)]
]

/** The pattern that finds a disable comment in a file, or undefined for a file no linter reads. */
const suppressionPattern = (file: string): RegExp | undefined => COMMENTS.find(([files]) => files.test(file))?.[1]

const JSON_FILE = /\.jsonc?$/

/**
 * JSON text with the inside of every string blanked, lines kept, so a value that shows a disable
 * comment, such as a snippet in a settings file, is not read as one. Comments are left as they are.
 */
export const blankJsonStrings = (text: string): string => {
  let out = ''
  let index = 0

  while (index < text.length) {
    const char = text[index] as string
    const next = text[index + 1]

    if (char === '"') {
      out += char
      index++

      while (index < text.length && text[index] !== '"' && text[index] !== '\n') {
        // An escape takes the character after it, so \" does not end the string.
        const width = text[index] === '\\' && text[index + 1] !== '\n' ? 2 : 1

        out += ' '.repeat(width)
        index += width
      }

      if (text[index] === '"') {
        out += '"'
        index++
      }

      continue
    }

    if (char === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? text.indexOf('\n', index) : text.indexOf('*/', index + 2) + 2
      // A line comment ends before its newline, a block comment after its */, and either at the end.
      const stop = end === -1 || end === 1 ? text.length : end

      out += text.slice(index, stop)
      index = stop

      continue
    }

    out += char
    index++
  }

  return out
}

export const readBaseline = (root: string): Baseline | undefined => {
  const baseline = readJson<Baseline>(join(root, BASELINE_FILE))

  return baseline?.version === 1
    ? { ...baseline, findings: baseline.findings ?? {}, suppressions: baseline.suppressions ?? {} }
    : undefined
}

/**
 * True when there is a baseline file that cannot be used: it is not valid JSON, as after a merge
 * conflict, or it is not a baseline this version of pawl knows.
 */
export const baselineUnreadable = (root: string): boolean =>
  existsSync(join(root, BASELINE_FILE)) && readBaseline(root) === undefined

/** The setup problem a baseline that is there but cannot be read is, or undefined when it is fine or absent. */
export const unreadableBaseline = (root: string): SetupIssue | undefined =>
  baselineUnreadable(root)
    ? {
        code: 'baseline-unreadable',
        message: `${BASELINE_FILE} cannot be read: it is not valid JSON, or not a baseline this version of pawl knows.`,
        fix: 'Resolve the merge conflict in it, or run "pawl baseline" to record the findings again.'
      }
    : undefined

export const writeBaseline = (root: string, baseline: Baseline): void => writeJson(join(root, BASELINE_FILE), baseline)

/** Find every comment that switches a check off. */
export const scanSuppressions = (
  root: string,
  ignored: (file: string) => boolean,
  files?: readonly string[]
): Suppression[] => {
  const found: Suppression[] = []

  for (const file of files ?? listFiles(root)) {
    const pattern = suppressionPattern(file)

    if (!pattern || ignored(file) || !existsSync(join(root, file))) continue

    const text = readFileSync(join(root, file), 'utf8')
    const lines = (JSON_FILE.test(file) ? blankJsonStrings(text) : text).split('\n')

    lines.forEach((text, index) => {
      const match = pattern.exec(text)

      if (match?.[1]) found.push({ file, line: index + 1, text: match[1] })
    })
  }

  return found
}

const countBy = (suppressions: readonly Suppression[]): Record<string, number> => {
  const counts: Record<string, number> = {}

  for (const { file } of suppressions) counts[file] = (counts[file] ?? 0) + 1

  return counts
}

export const createBaseline = (findings: readonly Finding[], suppressions: readonly Suppression[]): Baseline => {
  const byFile: Record<string, Record<string, number>> = {}

  for (const { file, rule } of findings) {
    byFile[file] ??= {}
    byFile[file][rule] = (byFile[file][rule] ?? 0) + 1
  }

  return {
    version: 1,
    findings: sortKeys(Object.fromEntries(Object.entries(byFile).map(([file, rules]) => [file, sortKeys(rules)]))),
    suppressions: sortKeys(countBy(suppressions))
  }
}

export interface BaselineResult {
  /** Findings the baseline does not cover. These fail the check. */
  fresh: Finding[]
  /** How many findings the baseline covered. */
  baselined: number
  /** The code now has fewer findings than the baseline allows, so the baseline can be tightened. */
  canShrink: boolean
}

/**
 * Split findings into those the baseline covers and those it does not.
 *
 * When a file has more of a rule than the baseline allows, every one of them is reported,
 * because counts cannot tell which one is new.
 */
export const applyBaseline = (findings: readonly Finding[], baseline: Baseline | undefined): BaselineResult => {
  if (!baseline) return { fresh: [...findings], baselined: 0, canShrink: false }

  const groups = new Map<string, Finding[]>()

  for (const finding of findings) {
    const key = `${finding.file}\n${finding.rule}`

    groups.set(key, [...(groups.get(key) ?? []), finding])
  }

  const fresh: Finding[] = []
  let baselined = 0
  let canShrink = false

  for (const group of groups.values()) {
    const first = group[0] as Finding
    const allowed = baseline.findings[first.file]?.[first.rule] ?? 0

    if (group.length <= allowed) {
      baselined += group.length
      canShrink ||= group.length < allowed
    } else if (allowed === 0) {
      fresh.push(...group)
    } else {
      fresh.push(...group.map(finding => ({ ...finding, overBaseline: { allowed, found: group.length } })))
    }
  }

  for (const [file, rules] of Object.entries(baseline.findings)) {
    for (const rule of Object.keys(rules)) canShrink ||= !groups.has(`${file}\n${rule}`)
  }

  return { fresh, baselined, canShrink }
}

/** The ratchet on disable comments: a file may not gain more than the baseline recorded. */
export const newSuppressions = (suppressions: readonly Suppression[], baseline: Baseline | undefined): Finding[] => {
  if (!baseline) return []

  const counts = countBy(suppressions)
  const findings: Finding[] = []

  for (const suppression of suppressions) {
    const allowed = baseline.suppressions[suppression.file] ?? 0
    const found = counts[suppression.file] ?? 0

    if (found <= allowed) continue

    findings.push({
      file: suppression.file,
      line: suppression.line,
      column: 1,
      engine: 'pawl',
      engineRule: 'no-new-disable',
      rule: 'pawl/no-new-disable',
      severity: 'error',
      message: `New "${suppression.text}" comment. Fix the finding instead of switching the check off.`,
      fixable: false,
      ...(allowed > 0 ? { overBaseline: { allowed, found } } : {})
    })
  }

  return findings
}
