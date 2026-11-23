import { join } from 'node:path'
import { type Engine, EngineError, type RunOptions } from '../engines/engine.ts'
import { checkLanguages } from '../engines/languages/check.ts'
import { activeEngines } from '../engines/registry.ts'
import { lockIssues } from '../policy/merge.ts'
import { loadProject } from '../policy/project.ts'
import { changedFiles, changedSince, listFiles, projectPath, SinceError } from '../project/files.ts'
import { configIgnores, ignoreMatcher } from '../project/ignores.ts'
import { runScans, scansReadIgnored } from '../scans/registry.ts'
import { scanIgnores } from '../scans/scan.ts'
import { type Finding, type Policy, type SetupIssue } from '../types.ts'
import { isDirectory } from '../utils/fs.ts'
import { mapAsync } from '../utils/list.ts'
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
import { scanTests, testCounts, weakerTests } from './tests.ts'

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

/** What one engine added to a check. */
interface EngineOutcome {
  findings: Finding[]
  setup: SetupIssue[]
  commands: string[]
}

/** Run one engine. An engine that cannot run is a setup problem, so the other engines still report. */
const runEngine = async (engine: Engine, options: RunOptions): Promise<EngineOutcome> => {
  try {
    const { findings, command } = await engine.run(options)

    return { findings, setup: [], commands: [command] }
  } catch (error) {
    if (!(error instanceof EngineError)) throw error

    const failed: SetupIssue = { code: 'engine-failed', message: `${engine.name} could not run: ${error.message}` }

    return { findings: [], setup: [failed], commands: [] }
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
  const { root, policy, detection } = project
  const setup: SetupIssue[] = []
  const commands: string[] = []
  const engines: CheckResult['engines'] = []
  const ignored = ignoreMatcher(root, policy, detection.ignores)
  // Pawl's own scans also read agent rules files in the folders the default ignores skip.
  const ownIgnored = scanIgnores(root, policy, detection.ignores, scansReadIgnored)
  const asked = options.files ? namedScope(root, options.files) : gitScope(root, options, setup)
  const scoped = asked && {
    targets: asked.targets.filter(file => !ignored(file)),
    files: asked.files.filter(file => !ownIgnored(file))
  }
  // Nothing for the engines: they do not run, though pawl's own scans may still have files.
  const noTargets = scoped !== undefined && scoped.targets.length === 0
  const empty = noTargets && scoped.files.length === 0
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
    ignore: configIgnores(policy, detection.ignores),
    gitignore: policy.gitignore
  }

  const active = activeEngines(project.tools)

  engines.push(...active.flatMap(engine => (engine.name === 'prettier' ? [] : [engine.name])))

  // A check only reads, so its engines run at the same time. A fix writes files that the next
  // engine reads, so there each engine waits for the one before it. Either way the outcomes are
  // taken in the order of the registry, so the report does not depend on which engine ends first.
  const outcomes = await mapAsync(
    active,
    async (engine): Promise<EngineOutcome> => {
      const state = engine.inspect(project)

      if (!engine.installed(root)) return { findings: [], setup: [...state.issues, engine.missing], commands: [] }

      if (idle || noTargets || !state.runnable) return { findings: [], setup: state.issues, commands: [] }

      const outcome = await runEngine(engine, run)

      return { ...outcome, setup: [...state.issues, ...outcome.setup] }
    },
    { together: !run.write }
  )

  for (const outcome of outcomes) {
    findings.push(...outcome.findings)
    setup.push(...outcome.setup)
    commands.push(...outcome.commands)
  }

  // Pawl's own checks for the files no engine reads.
  if (!idle) {
    findings.push(...runScans({ root, policy, ignores: detection.ignores, ...own }))

    // The other languages the policy names, each with its own tools.
    // The tools of other languages get only the files past every ignore.
    const languageFiles = scoped ? { files: scoped.files.filter(file => !ignored(file)) } : {}
    const languages = await checkLanguages({
      root,
      policy,
      detection,
      ignored,
      write: options.fix === true,
      ...languageFiles
    })

    engines.push(...languages.engines)
    commands.push(...languages.commands)
    setup.push(...languages.setup)
    findings.push(...languages.findings)
  }

  const maxWarnings = lowerLimit(options.maxWarnings, policy.maxWarnings)
  const limit = maxWarnings === undefined ? {} : { maxWarnings }

  // The policy's ignore list applies at once, even before the engine config is synced. Pawl's own
  // findings follow the ignores of its scans, which read agent rules files the engines skip.
  const kept = findings.filter(finding => !(finding.engine === 'pawl' ? ownIgnored : ignored)(finding.file))
  const suppressions = idle ? [] : scanSuppressions(root, ignored, scoped?.files)
  const tests = idle ? [] : scanTests(root, ignored, scoped?.files)

  if (options.updateBaseline) {
    // A check that did not complete knows only some of the findings. Recorded as the baseline,
    // they would make every finding it missed fail later as new, so the file is left as it is.
    const complete = !isBlocked(setup)

    if (complete) writeBaseline(root, createBaseline(kept, suppressions, testCounts(tests)))

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
  const whole = scoped === undefined && !isBlocked(setup)
  const ratchet = weakerTests(tests, baseline?.tests, { policy, whole, ignored })
  const uncounted = baseline !== undefined && baseline.tests === undefined && testCounts(tests)

  // A new skipped test the ratchet fails is the one the engine's own skipped-test rule warns about.
  const skips = new Set(ratchet.findings.map(finding => `${finding.file}:${finding.line}`))
  const engineFresh = fresh.filter(
    finding => !(finding.rule === 'vitest/no-disabled-tests' && skips.has(`${finding.file}:${finding.line}`))
  )

  return {
    findings: [...engineFresh, ...newSuppressions(suppressions, baseline), ...ratchet.findings].sort(byPosition),
    baselined,
    setup,
    engines,
    commands,
    hasBaseline: baseline !== undefined,
    // A partial run cannot tell whether findings elsewhere are gone, nor can a run where an engine failed.
    canShrinkBaseline: whole && (canShrink || ratchet.canTighten),
    ...(uncounted && Object.keys(uncounted).length > 0 ? { testsUncounted: true } : {}),
    nothingToCheck: empty,
    ...limit
  }
}
