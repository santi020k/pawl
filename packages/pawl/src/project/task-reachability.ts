/** Conservative script evidence for the doctor. Never used to disable lint rules. */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { toPosix } from '../utils/fs.ts'
import { isRecord, readJson, readJsonc } from '../utils/json.ts'
import { detect } from './detect.ts'

export type TaskCache = 'cached' | 'uncached' | 'unknown'
/** Positive consumer evidence only; uncached never proves exclusive runtime use. */
export type TaskFileReachability = TaskCache | 'mixed'

export interface TaskConsumer {
  /** Package directory and script name; root tasks start with //#. */
  id: string
  directory: string
  script: string
  cache: TaskCache
  entries: string[]
}

export interface TaskFile {
  path: string
  reachability: TaskFileReachability
  consumers: string[]
}

/** Static evidence is always partial: arbitrary JavaScript and external callers are not modeled. */
export interface TaskReachability {
  complete: false
  tasks: TaskConsumer[]
  files: TaskFile[]
  /** Unsupported or unreadable inputs prevent claims of exclusively uncached use. */
  issues: string[]
}

type Scripts = Record<string, string>

const configAt = (directory: string): string | undefined =>
  ['turbo.json', 'turbo.jsonc'].find(file => existsSync(join(directory, file)))

const taskCache = (value: unknown, issues: Set<string>, label: string): TaskCache => {
  if (value === undefined) return 'uncached'
  if (!isRecord(value) || (value.cache !== undefined && typeof value.cache !== 'boolean') || 'extends' in value) {
    issues.add(`${label}: unsupported task configuration`)
    return 'unknown'
  }
  return value.cache === false ? 'uncached' : 'cached'
}

/** Resolve only exact local files, never execute scripts or follow paths outside the project. */
const localFile = (root: string, directory: string, name: string): string | undefined => {
  const absolute = resolve(root, directory, name)
  const within = (file: string): boolean => {
    const path = relative(root, file)
    return path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path)
  }
  try {
    if (!within(absolute) || !within(realpathSync(absolute)) || !statSync(absolute).isFile()) return undefined
    return toPosix(relative(root, absolute))
  } catch {
    return undefined
  }
}

/** Literal commands only. Shell expansion, flags, pipelines and tool-specific entry discovery are unknown. */
const entriesFor = (
  root: string,
  directory: string,
  script: string,
  scripts: Scripts,
  issues: Set<string>,
  seen = new Set<string>()
): string[] => {
  const label = `${directory || '//'}#${script}`
  const command = scripts[script]
  if (seen.has(script) || command === undefined) {
    issues.add(`${label}: missing or cyclic script reference`)
    return []
  }
  if (scripts[`pre${script}`] !== undefined || scripts[`post${script}`] !== undefined)
    issues.add(`${label}: lifecycle scripts require manual review`)
  const next = new Set([...seen, script])
  const nested = /^(?:pnpm|npm|yarn|bun) run ([\w:.-]+)$/.exec(command.trim())
  if (nested?.[1]) return entriesFor(root, directory, nested[1], scripts, issues, next)
  const direct = /^(?:node|tsx) ([\w./-]+\.(?:[cm]?[jt]s))$/.exec(command.trim())
  const file = direct?.[1] ? localFile(root, directory, direct[1]) : undefined
  if (file !== undefined) return [file]
  issues.add(`${label}: command entry cannot be resolved statically`)
  return []
}

/**
 * Imports are positive evidence only, not a JavaScript parser. Unsupported imports and loaders
 * keep uncached use uncertain. False positives (for example in comments) can only retain checks.
 */
const moduleFiles = (root: string, entry: string, issues: Set<string>): string[] => {
  const found = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || found.has(file)) continue
    if (found.size >= 500) {
      issues.add(`${entry}: module traversal limit reached`)
      break
    }
    found.add(file)
    let source: string
    try {
      source = readFileSync(join(root, file), 'utf8')
    } catch {
      issues.add(`${file}: module could not be read`)
      continue
    }
    const staticImport = /\b(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"\n]+)['"]/g
    const remainder = source.replace(staticImport, '')
    if (/\b(?:require|import|eval|createRequire|exec|spawn)\b/.test(remainder))
      issues.add(`${file}: dynamic loading or subprocess execution needs manual review`)
    const imports = source.matchAll(staticImport)
    for (const match of imports) {
      const specifier = match[1]
      if (specifier === undefined) continue
      if (/^node:(?:child_process|module|vm|worker_threads)$/.test(specifier))
        issues.add(`${file}: loader or subprocess module requires manual review`)
      if (specifier.startsWith('node:')) continue
      const target = specifier.startsWith('.') ? localFile(root, dirname(file), specifier) : undefined
      if (target === undefined) issues.add(`${file}: import ${specifier} cannot be resolved statically`)
      else pending.push(target)
    }
  }
  return [...found].sort()
}

/**
 * Inspect declared package scripts and literal Turbo cache settings. Package directories can be
 * supplied from an existing detection result. Results describe evidence, never a lint exemption.
 */
export const analyzeTaskReachability = (
  projectRoot: string,
  packageDirectories?: readonly string[]
): TaskReachability => {
  const root = resolve(projectRoot)
  const issues = new Set<string>()
  const tasks: TaskConsumer[] = []
  const configName = configAt(root)
  const config = configName === undefined ? undefined : readJsonc<unknown>(join(root, configName)).value
  const validConfig = configName === undefined || (isRecord(config) && isRecord(config.tasks) && !('extends' in config))
  if (!validConfig) issues.add(`${configName}: invalid or unsupported Turbo configuration`)
  const definitions = isRecord(config) && isRecord(config.tasks) ? config.tasks : {}
  const directories = [...new Set(['', ...(packageDirectories ?? detect(root).workspace.packages)])].sort()
  const rootManifest = readJson<unknown>(join(root, 'package.json'))
  const workspace =
    directories.length > 1 ||
    existsSync(join(root, 'pnpm-workspace.yaml')) ||
    (isRecord(rootManifest) && rootManifest.workspaces !== undefined)
  const invalidQualified = !workspace && Object.keys(definitions).some(name => name.includes('#'))
  if (invalidQualified)
    issues.add(`${configName}: qualified task names are invalid in a standalone project; use bare task names`)
  for (const directory of directories) {
    const manifestFile = localFile(root, directory, 'package.json')
    const manifest = manifestFile === undefined ? undefined : readJson<unknown>(join(root, manifestFile))
    if (!isRecord(manifest) || (manifest.scripts !== undefined && !isRecord(manifest.scripts))) {
      issues.add(`${directory || '.'}: invalid or missing package manifest`)
      continue
    }
    if (directory !== '' && typeof manifest.name !== 'string')
      issues.add(`${directory}: workspace package name is missing or invalid`)
    const scripts: Scripts = {}
    for (const [name, command] of Object.entries(isRecord(manifest.scripts) ? manifest.scripts : {})) {
      if (typeof command === 'string') scripts[name] = command
      else issues.add(`${directory || '.'}#${name}: script is not a string`)
    }
    // Package configuration inheritance is deliberately unknown until fully modeled.
    const localConfig = directory !== '' && configAt(join(root, directory)) !== undefined
    if (localConfig) issues.add(`${directory}: package Turbo configuration requires manual review`)
    for (const script of Object.keys(scripts).sort()) {
      const id = `${directory || '//'}#${script}`
      const qualified = directory === '' ? `//#${script}` : `${String(manifest.name)}#${script}`
      const definition =
        directory === '' && !workspace
          ? definitions[script]
          : (definitions[qualified] ?? (directory === '' ? undefined : definitions[script]))
      const cache = validConfig && !localConfig && !invalidQualified ? taskCache(definition, issues, id) : 'unknown'
      tasks.push({ id, directory, script, cache, entries: entriesFor(root, directory, script, scripts, issues) })
    }
  }
  const consumers = new Map<string, TaskConsumer[]>()
  for (const task of tasks) {
    for (const entry of task.entries) {
      for (const file of moduleFiles(root, entry, issues)) {
        const previous = consumers.get(file) ?? []
        if (!previous.includes(task)) previous.push(task)
        consumers.set(file, previous)
      }
    }
  }
  const files = [...consumers]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, users]): TaskFile => {
      const cached = users.some(task => task.cache === 'cached')
      const uncached = users.some(task => task.cache === 'uncached')
      const unknown = issues.size > 0 || users.some(task => task.cache === 'unknown')
      let reachability: TaskFileReachability = unknown ? 'unknown' : 'uncached'
      if (cached) reachability = uncached ? 'mixed' : 'cached'
      return {
        path,
        reachability,
        consumers: users.map(task => task.id).sort()
      }
    })
  return { complete: false, tasks, files, issues: [...issues].sort() }
}
