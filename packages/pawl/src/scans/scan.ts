import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from '../project/files.ts'
import { ignoreMatcher, makeIgnore } from '../project/ignores.ts'
import { type Finding, type Level, type Override, type Policy } from '../types.ts'

/**
 * One of pawl's own rules. No engine pawl drives reads the files these are for, so pawl checks
 * them itself, each with a plain line scan.
 */
export interface OwnRule {
  name: string
  level: Level
  summary: string
  advice: string
}

/** One of pawl's own rules, named `pawl/<name>`. */
export const ownRule = (name: string, level: Level, summary: string, advice: string): OwnRule => ({
  name: `pawl/${name}`,
  level,
  summary,
  advice
})

const overrideMatchers = new WeakMap<Override, (file: string) => boolean>()

/** True when an override's patterns name a file. */
const overrideCovers = (override: Override, file: string): boolean => {
  const matcher = overrideMatchers.get(override) ?? makeIgnore(override.files)

  overrideMatchers.set(override, matcher)

  return matcher(file)
}

/**
 * The level of one of pawl's own checks for one file: the policy's level, else the check's own,
 * then the overrides that name the file, the later ones winning, as the engines read them.
 */
export const levelForFile = (policy: Policy, name: string, file: string, fallback: Level): Level =>
  policy.overrides.reduce(
    (level, override) =>
      name in override.rules && overrideCovers(override, file) ? (override.rules[name] as Level) : level,
    policy.rules[name] ?? fallback
  )

/** Report a problem with one of the scan's rules, by the rule's short name, with an optional detail. */
export type Report = (rule: string, line: number, column: number, detail?: string) => void

/** The files a scan reads, the rules it has, and the scan itself. */
export interface Scan {
  /** The files it reads, in words, such as "Markdown files". */
  reads: string
  rules: readonly OwnRule[]
  matches: (file: string) => boolean
  scan: (file: string, text: string, report: Report) => void
}

export interface ScanOptions {
  root: string
  policy: Policy
  /** Only look at these files, relative to the root. */
  files?: readonly string[]
  /** Patterns to skip that detection found, such as the target folder of a Rust project. */
  ignores?: readonly string[]
}

/** Run a scan over the project's files, or the ones given, and turn what it reports into findings. */
export const runScan = (scan: Scan, { root, policy, files, ignores }: ScanOptions): Finding[] => {
  const ignored = ignoreMatcher(root, policy, ignores)
  const rules = new Map(scan.rules.map(rule => [rule.name, rule]))
  const findings: Finding[] = []

  for (const file of (files ?? listFiles(root)).filter(name => scan.matches(name) && !ignored(name))) {
    const path = join(root, file)

    if (!existsSync(path)) continue

    const report: Report = (short, line, column, detail) => {
      const def = rules.get(`pawl/${short}`)
      const severity = def ? levelForFile(policy, def.name, file, def.level) : 'off'

      if (!def || severity === 'off') return

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

    scan.scan(file, readFileSync(path, 'utf8'), report)
  }

  return findings
}
