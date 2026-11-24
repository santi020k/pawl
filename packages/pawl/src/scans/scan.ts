import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from '../project/files.ts'
import { chosenIgnoreMatcher, ignoreMatcher, makeIgnore } from '../project/ignores.ts'
import { type Finding, type Level, type Override, type Policy } from '../types.ts'
import { isFile } from '../utils/fs.ts'

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
  /**
   * The files it reads even in the folders pawl's default ignores skip, such as the rules files AI
   * tools keep in their own folders. The policy's own ignores and the .gitignore still apply.
   */
  readsIgnored?: (file: string) => boolean
  /** Files to read beyond what git lists, such as those the directory walk skips outside a repository. */
  alsoLists?: (root: string) => string[]
  scan: (file: string, text: string, report: Report) => void
}

/**
 * What a scan skips: what every check skips, except the files the scan reads in the folders the
 * defaults skip, as long as the person did not ignore them themselves.
 */
export const scanIgnores = (
  root: string,
  policy: Policy,
  ignores: readonly string[] | undefined,
  readsIgnored: ((file: string) => boolean) | undefined
): ((file: string) => boolean) => {
  const ignored = ignoreMatcher(root, policy, ignores)

  if (!readsIgnored) return ignored

  const chosen = chosenIgnoreMatcher(root, policy)

  // The chosen ignores still skip node_modules, .git and .pawl.
  return file => ignored(file) && !(readsIgnored(file) && !chosen(file))
}

export interface ScanOptions {
  root: string
  policy: Policy
  /** Only look at these files, relative to the root. */
  files?: readonly string[]
  /** Cached project files to reuse when checking the whole project. Keeps alsoLists active. */
  projectFiles?: readonly string[]
  /** Patterns to skip that detection found, such as the target folder of a Rust project. */
  ignores?: readonly string[]
}

/** Run a scan over the project's files, or the ones given, and turn what it reports into findings. */
export const runScan = (scan: Scan, { root, policy, files, projectFiles, ignores }: ScanOptions): Finding[] => {
  const ignored = scanIgnores(root, policy, ignores, scan.readsIgnored)
  const rules = new Map(scan.rules.map(rule => [rule.name, rule]))
  const findings: Finding[] = []

  const listed = files ?? [...new Set([...(projectFiles ?? listFiles(root)), ...(scan.alsoLists?.(root) ?? [])])]

  for (const file of listed.filter(name => scan.matches(name) && !ignored(name))) {
    const path = join(root, file)

    if (!isFile(path)) continue

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
