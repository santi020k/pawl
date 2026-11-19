import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles, makeIgnore, readJson, writeJson } from './fs-utils.ts'
import { type Finding } from './types.ts'

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

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/

const SUPPRESSION =
  /(?:\/\/|\/\*|\*|<!--)\s*(biome-ignore(?:-all|-start)?|eslint-disable(?:-next-line|-line)?|@ts-ignore|@ts-expect-error|@ts-nocheck)\b/

const sortKeys = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

export const readBaseline = (root: string): Baseline | undefined => {
  const baseline = readJson<Baseline>(join(root, BASELINE_FILE))

  return baseline?.version === 1
    ? { ...baseline, findings: baseline.findings ?? {}, suppressions: baseline.suppressions ?? {} }
    : undefined
}

export const writeBaseline = (root: string, baseline: Baseline): void => writeJson(join(root, BASELINE_FILE), baseline)

/** Find every comment that switches a check off. */
export const scanSuppressions = (root: string, ignore: readonly string[], files?: readonly string[]): Suppression[] => {
  const ignored = makeIgnore(ignore)
  const found: Suppression[] = []

  for (const file of files ?? listFiles(root)) {
    if (!SOURCE_FILE.test(file) || ignored(file) || !existsSync(join(root, file))) continue

    const lines = readFileSync(join(root, file), 'utf8').split('\n')

    lines.forEach((text, index) => {
      const match = SUPPRESSION.exec(text)

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
