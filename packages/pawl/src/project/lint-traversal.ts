/** Conservative directory-overlap evidence for declared lint commands. Never changes coverage. */
import { statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { isRecord, readJson } from '../utils/json.ts'

export type LintTool = 'pawl' | 'biome' | 'eslint' | 'oxlint' | 'prettier'

export interface LintTraversal {
  manifest: string
  script: string
  tool: LintTool
  /** Repository-relative literal directory. Empty means the whole repository. */
  directory: string
}

export interface LintOverlap {
  first: LintTraversal
  second: LintTraversal
  /** Directory potentially visited by both commands, before their engine-specific ignores. */
  directory: string
}

export interface LintTraversalReport {
  commands: LintTraversal[]
  overlaps: LintOverlap[]
  /** Commands whose scope could not be inferred. They are not evidence of disjoint coverage. */
  unknown: string[]
}

const tools: readonly string[] = ['pawl', 'biome', 'eslint', 'oxlint', 'prettier']
const isTool = (value: string): value is LintTool => tools.includes(value)
const commands: Record<'pawl' | 'biome', ReadonlySet<string>> = {
  pawl: new Set(['check', 'fix']),
  biome: new Set(['check', 'lint', 'format', 'ci'])
}
const scopeFlags = new Set(['--changed', '--since', '--staged', '--stdin-filepath', '--files', '--filter', '--cwd'])
const pathFlags = new Set(['--config', '-c', '--ignore-path', '--cache-location', '--max-warnings', '--format'])

/** Only unquoted commands with literal directory targets have a scope we can describe. */
const traversal = (
  root: string,
  dir: string,
  manifest: string,
  script: string,
  command: string
): LintTraversalReport => {
  const report: LintTraversalReport = { commands: [], overlaps: [], unknown: [] }
  const raw = command.trim().split(/\s+/)
  const mention = raw.find(word => isTool(word))

  if (!mention) return report

  const label = `${manifest} script "${script}"`
  const unknown = (): LintTraversalReport => {
    report.unknown.push(`${label}: lint scope is unknown; inspect its wrappers, flags and engine ignores.`)

    return report
  }

  // Shell variables, quoting, redirects and pipelines need a shell parser, not guessed semantics.
  if (/["'`$|;&<>\n]/.test(command)) return unknown()

  const words = [...raw]

  if (['pnpm', 'npm', 'yarn', 'bun', 'npx'].includes(words[0] ?? '')) {
    const manager = words.shift()

    if (words[0] === 'exec' || (manager === 'bun' && words[0] === 'x')) words.shift()
    else if (manager !== 'npx') return unknown()
  }

  const tool = words.shift()

  if (tool === undefined || !isTool(tool)) return unknown()

  if (tool === 'pawl' || tool === 'biome') {
    const action = words.shift()

    if (!action || !commands[tool].has(action)) return report
  }

  const targets: string[] = []
  let explicitTarget = false

  for (let index = 0; index < words.length; index++) {
    const word = words[index]

    if (word === undefined) continue

    if (scopeFlags.has(word.split('=')[0] ?? word)) return unknown()

    if (pathFlags.has(word)) {
      if (words[index + 1] === undefined) return unknown()

      index++
    } else if (word.startsWith('-')) {
      if (
        ![
          '--check',
          '--write',
          '--fix',
          '--cache',
          '--no-warn-ignored',
          '--no-error-on-unmatched-pattern',
          '--ci',
          '--'
        ].includes(word)
      )
        return unknown()
    } else {
      explicitTarget = true

      if (/[*?{}[\]\\]/.test(word) || word.startsWith('/')) return unknown()

      const directory = posix.normalize(posix.join(dir, word))

      if (directory === '..' || directory.startsWith('../')) return unknown()

      // A file target is not a recursive traversal. Existing directories and explicit '.' are evidence.
      try {
        if (statSync(join(root, directory)).isDirectory()) targets.push(directory)
      } catch {
        return unknown()
      }
    }
  }

  if (targets.length === 0) {
    if (explicitTarget) return report

    if (tool !== 'pawl') return unknown()

    targets.push(dir || '.')
  }

  report.commands = [...new Set(targets)].map(directory => ({
    manifest,
    script,
    tool,
    directory: directory === '.' ? '' : directory
  }))

  return report
}

const nested = (parent: string, child: string): boolean =>
  parent === '' || child === parent || child.startsWith(`${parent}/`)

/** Inspect declarations, not shell execution. An overlap is advisory, never proof that both tasks run. */
export const analyzeLintTraversal = (root: string, packageDirectories: readonly string[] = []): LintTraversalReport => {
  const report: LintTraversalReport = { commands: [], overlaps: [], unknown: [] }

  for (const dir of [...new Set(['', ...packageDirectories])].sort()) {
    const manifest = posix.join(dir, 'package.json')
    const value = readJson<unknown>(join(root, manifest))

    if (!isRecord(value) || !isRecord(value.scripts)) continue

    for (const [script, command] of Object.entries(value.scripts)) {
      if (typeof command !== 'string') continue

      const inspected = traversal(root, dir, manifest, script, command)

      report.commands.push(...inspected.commands)
      report.unknown.push(...inspected.unknown)
    }
  }

  for (const [index, first] of report.commands.entries()) {
    for (const second of report.commands.slice(index + 1)) {
      // A package's check and fix scripts are usually alternatives. Focus on root/package ownership.
      if (first.manifest === second.manifest) continue

      if (first.tool !== second.tool && first.tool !== 'pawl' && second.tool !== 'pawl') continue

      let directory: string | undefined

      if (nested(first.directory, second.directory)) directory = second.directory
      else if (nested(second.directory, first.directory)) directory = first.directory

      if (directory !== undefined) report.overlaps.push({ first, second, directory })
    }
  }

  return report
}
