import { join } from 'node:path'
import { type Engine, EngineError, type RunOptions } from '../engines/engine.ts'
import { activeEngines } from '../engines/registry.ts'
import { lockIssues } from '../policy/merge.ts'
import { loadProject } from '../policy/project.ts'
import { changedFiles, changedSince, listFiles, projectPath, SinceError } from '../project/files.ts'
import { configIgnores, ignoreMatcher } from '../project/ignores.ts'
import { runScans } from '../scans/registry.ts'
import { type EngineName, type Finding, type Policy, type SetupIssue } from '../types.ts'
import { isDirectory } from '../utils/fs.ts'
import {
  applyBaseline,
  createBaseline,
  newSuppressions,
  readBaseline,
  scanSuppressions,
  unreadableBaseline,
  writeBaseline
} from './baseline.ts'
import { type CheckResult, isBlocked } from './result.ts'

export interface CheckOptions {
  root: string
  /** Only look at files changed against HEAD, plus untracked ones. Outside a git repository, every file. */
  changed?: boolean
  /** Only look at files changed since the branch left this git ref, such as `origin/main`. */
  since?: string
  /**
   * Only look at these files and folders. Each is relative to the root, or absolute and inside it;
   * a folder stands for every file in it.
   */
  files?: readonly string[]
  /** Apply safe fixes and formatting before reporting. */
  fix?: boolean
  /** Record everything found as the new baseline and report nothing. */
  updateBaseline?: boolean
  /** Reuse a policy that is already loaded. */
  policy?: Policy
  /** Fail when there are more new warnings than this. The policy's `maxWarnings`, when lower, wins. */
  maxWarnings?: number
}

/** The lower of two warning limits, so a command line cannot loosen what the policy sets. */
const lowerLimit = (...limits: (number | undefined)[]): number | undefined => {
  const given = limits.filter((limit): limit is number => limit !== undefined)

  return given.length > 0 ? Math.min(...given) : undefined
}

const byPosition = (a: Finding, b: Finding): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule)

/** Run one engine. An engine that cannot run is a setup problem, so the other engines still report. */
const runEngine = async (
  engine: Engine,
  options: RunOptions,
  setup: SetupIssue[],
  commands: string[]
): Promise<Finding[]> => {
  try {
    const { findings, command } = await engine.run(options)

    commands.push(command)

    return findings
  } catch (error) {
    if (!(error instanceof EngineError)) throw error

    setup.push({ code: 'engine-failed', message: `${engine.name} could not run: ${error.message}` })

    return []
  }
}

/** The part of a project a run looks at. */
interface Scope {
  /** What the engines are given: files, and folders as the caller named them. */
  targets: string[]
  /** Every file in scope, one by one, for pawl's own checks. */
  files: string[]
}

/** The files `--since` or `--changed` asks for. Undefined means every file. */
const gitScope = (root: string, options: CheckOptions, setup: SetupIssue[]): Scope | undefined => {
  const whole = (files: string[]): Scope => ({ targets: files, files })

  if (options.since === undefined) {
    const changed = options.changed ? changedFiles(root) : undefined

    return changed && whole(changed)
  }

  try {
    return whole(changedSince(root, options.since))
  } catch (error) {
    if (!(error instanceof SinceError)) throw error

    // Nothing runs: checking every file, or none, would answer a question nobody asked.
    setup.push({ code: 'since-unresolved', message: error.message, fix: error.fix })

    return whole([])
  }
}

/**
 * The files and folders a caller named, as project paths. The engines walk a folder themselves;
 * pawl's own checks need its files listed. Naming the root is the same as naming nothing.
 */
const namedScope = (root: string, named: readonly string[]): Scope | undefined => {
  const targets = [...new Set(named.flatMap(file => projectPath(root, file) ?? []))]

  if (targets.includes('.')) return undefined

  const folders = targets.filter(target => isDirectory(join(root, target)))

  if (folders.length === 0) return { targets, files: targets }

  const inFolders = listFiles(root).filter(file => folders.some(folder => file.startsWith(`${folder}/`)))

  return { targets, files: [...new Set([...targets.filter(target => !folders.includes(target)), ...inFolders])] }
}

/** Run every active engine, then pawl's own checks, and compare with the baseline. */
export const check = async (options: CheckOptions): Promise<CheckResult> => {
  const project = await loadProject(options.root, options.policy)
  const { root, policy } = project
  const setup: SetupIssue[] = []
  const commands: string[] = []
  const engines: EngineName[] = []
  const ignored = ignoreMatcher(root, policy)
  const asked = options.files ? namedScope(root, options.files) : gitScope(root, options, setup)
  const scoped = asked && {
    targets: asked.targets.filter(file => !ignored(file)),
    files: asked.files.filter(file => !ignored(file))
  }
  const empty = scoped !== undefined && scoped.targets.length === 0
  // Without its baseline a check would report every old finding as new, so it does not run at all.
  const unreadable = options.updateBaseline === true ? undefined : unreadableBaseline(root)
  const idle = empty || unreadable !== undefined

  if (unreadable) setup.push(unreadable)

  setup.push(...lockIssues(policy))

  const findings: Finding[] = []
  const own = scoped ? { files: scoped.files } : {}
  const run: RunOptions = {
    root,
    ...(scoped ? { files: scoped.targets } : {}),
    write: options.fix === true,
    // For Prettier, which has no config file of pawl's to read them from.
    ignore: configIgnores(policy),
    gitignore: policy.gitignore
  }

  for (const engine of activeEngines(project.tools)) {
    if (engine.name !== 'prettier') engines.push(engine.name)

    const state = engine.inspect(project)

    setup.push(...state.issues)

    if (!engine.installed(root)) setup.push(engine.missing)
    else if (!idle && state.runnable) findings.push(...(await runEngine(engine, run, setup, commands)))
  }

  // Pawl's own checks for the files no engine reads.
  if (!idle) findings.push(...runScans({ root, policy, ...own }))

  const maxWarnings = lowerLimit(options.maxWarnings, policy.maxWarnings)
  const limit = maxWarnings === undefined ? {} : { maxWarnings }

  // The policy's ignore list applies at once, even before the engine config is synced.
  const kept = findings.filter(finding => !ignored(finding.file))
  const suppressions = idle ? [] : scanSuppressions(root, ignored, scoped?.files)

  if (options.updateBaseline) {
    // A check that did not complete knows only some of the findings. Recorded as the baseline,
    // they would make every finding it missed fail later as new, so the file is left as it is.
    const complete = !isBlocked(setup)

    if (complete) writeBaseline(root, createBaseline(kept, suppressions))

    return {
      findings: [],
      baselined: complete ? kept.length : 0,
      setup,
      engines,
      commands,
      hasBaseline: complete || readBaseline(root) !== undefined,
      canShrinkBaseline: false,
      nothingToCheck: empty,
      ...limit
    }
  }

  const baseline = readBaseline(root)
  const { fresh, baselined, canShrink } = applyBaseline(kept, baseline)

  return {
    findings: [...fresh, ...newSuppressions(suppressions, baseline)].sort(byPosition),
    baselined,
    setup,
    engines,
    commands,
    hasBaseline: baseline !== undefined,
    // A partial run cannot tell whether findings elsewhere are gone.
    canShrinkBaseline: scoped === undefined && canShrink,
    nothingToCheck: empty,
    ...limit
  }
}
