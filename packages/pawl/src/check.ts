import {
  applyBaseline,
  createBaseline,
  newSuppressions,
  readBaseline,
  scanSuppressions,
  writeBaseline
} from './baseline.ts'
import { detect, packageTechnologies } from './detect.ts'
import { checkDocker } from './docker.ts'
import {
  biomeContextFor,
  checkBiomeConfig,
  checkBiomePackages,
  checkRuleFiles,
  type EngineRun,
  runBiome
} from './engines/biome.ts'
import { eslintInstalled, runEslint } from './engines/eslint.ts'
import { checkLanguages } from './engines/languages.ts'
import { checkOxlintConfig, oxlintContextFor, oxlintInstalled, runOxlint } from './engines/oxlint.ts'
import { checkPrettierConfig, prettierInstalled, runPrettier } from './engines/prettier.ts'
import { EngineError } from './engines/run.ts'
import { changedFiles, changedSince, SinceError } from './fs-utils.ts'
import { ignoreMatcher } from './ignores.ts'
import { checkMarkdown } from './markdown.ts'
import { loadPolicy } from './policy.ts'
import { toolset } from './tools.ts'
import { type EngineName, type Finding, type LanguageEngine, type Policy, type SetupIssue } from './types.ts'

export interface CheckOptions {
  root: string
  /** Only look at files changed against HEAD, plus untracked ones. */
  changed?: boolean
  /** Only look at files changed since the branch left this git ref, such as `origin/main`. */
  since?: string
  /** Only look at these files, relative to the root. */
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

export interface CheckResult {
  /** Findings the baseline does not cover, sorted by file and position. */
  findings: Finding[]
  /** Findings hidden because the baseline allows them. */
  baselined: number
  /** Problems with the setup itself. */
  setup: SetupIssue[]
  /** The engines that ran, and the tools of the other languages the policy names. */
  engines: (EngineName | LanguageEngine)[]
  /** The engine commands that ran, as a person would type them. */
  commands: string[]
  hasBaseline: boolean
  canShrinkBaseline: boolean
  /** True when there were no files to look at, such as `--changed` on a clean tree. */
  nothingToCheck: boolean
  /** More new warnings than this fail the check. Undefined means warnings never fail it. */
  maxWarnings?: number
}

export const EXIT_OK = 0

export const EXIT_FINDINGS = 1

export const EXIT_SETUP = 2

/** Setup problems that mean part of the check did not run at all. */
export const BLOCKING: readonly SetupIssue['code'][] = [
  'engine-failed',
  'eslint-missing',
  'prettier-missing',
  'oxlint-missing',
  'oxlint-config-missing',
  'biome-config-missing',
  'since-unresolved',
  'language-tool-missing'
]

/** True when the result has more new warnings than its limit allows. */
export const tooManyWarnings = (result: CheckResult): boolean =>
  result.maxWarnings !== undefined &&
  result.findings.filter(finding => finding.severity === 'warn').length > result.maxWarnings

/** Exit code for a result. Setup problems only fail the run in CI, where drift must not pass. */
export const exitCode = (result: CheckResult, ci = false): number => {
  if (result.setup.some(issue => BLOCKING.includes(issue.code))) return EXIT_SETUP

  if (ci && result.setup.length > 0) return EXIT_SETUP

  if (tooManyWarnings(result)) return EXIT_FINDINGS

  return result.findings.some(finding => finding.severity === 'error') ? EXIT_FINDINGS : EXIT_OK
}

/** The lower of two warning limits, so a command line cannot loosen what the policy sets. */
const lowerLimit = (...limits: (number | undefined)[]): number | undefined => {
  const given = limits.filter((limit): limit is number => limit !== undefined)

  return given.length > 0 ? Math.min(...given) : undefined
}

const byPosition = (a: Finding, b: Finding): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule)

const runEngine = async (
  name: EngineName | 'prettier',
  run: () => Promise<EngineRun>,
  setup: SetupIssue[],
  commands: string[]
): Promise<Finding[]> => {
  try {
    const { findings, command } = await run()

    commands.push(command)

    return findings
  } catch (error) {
    if (!(error instanceof EngineError)) throw error

    setup.push({ code: 'engine-failed', message: `${name} could not run: ${error.message}` })

    return []
  }
}

/** The files `--since` or `--changed` asks for. Undefined means every file. */
const scopedFiles = (root: string, options: CheckOptions, setup: SetupIssue[]): string[] | undefined => {
  if (options.since === undefined) return options.changed ? changedFiles(root) : undefined

  try {
    return changedSince(root, options.since)
  } catch (error) {
    if (!(error instanceof SinceError)) throw error

    // Nothing runs: checking every file, or none, would answer a question nobody asked.
    setup.push({ code: 'since-unresolved', message: error.message, fix: error.fix })

    return []
  }
}

/** Run every active engine, then pawl's own checks, and compare with the baseline. */
export const check = async (options: CheckOptions): Promise<CheckResult> => {
  const { root } = options
  const policy = options.policy ?? (await loadPolicy(root))
  const setup: SetupIssue[] = []
  const commands: string[] = []
  const engines: (EngineName | LanguageEngine)[] = []
  const detection = detect(root, policy)
  const ignored = ignoreMatcher(root, policy, detection.ignores)
  const scoped = options.files ?? scopedFiles(root, options, setup)
  const files = scoped?.filter(file => !ignored(file))
  const empty = files !== undefined && files.length === 0

  for (const violation of policy.lockViolations) {
    setup.push({
      code: 'locked-rule',
      message: `"${violation.rule}" is locked at "${violation.kept}" by the policy this repo extends. ${violation.source} tried to set it to "${violation.wanted}".`,
      fix: `Remove the "${violation.rule}" override from ${violation.source}.`
    })
  }

  const findings: Finding[] = []
  const tools = toolset(root, policy)
  const scope = files ? { files } : {}
  const write = options.fix === true

  if (tools.biome) {
    engines.push('biome')

    const context = biomeContextFor(root, policy, detection, tools)
    const config = checkBiomeConfig(root, policy, context)

    if (config.issue) setup.push(config.issue)

    for (const state of checkBiomePackages(root, packageTechnologies(detection), config.file, config.preset)) {
      if (state.status === 'ok') continue

      setup.push({
        code: 'biome-config-stale',
        message: `${state.file} is ${state.status === 'missing' ? 'missing' : 'out of date'}, so the rules for what that package uses are not applied there.`,
        fix: 'Run "pawl sync".'
      })
    }

    const packageDirs = Object.keys(packageTechnologies(detection))
    const rules = checkRuleFiles(root, policy, context, packageDirs).filter(state => state.status !== 'ok')

    for (const state of rules) {
      setup.push({
        code: 'biome-config-stale',
        message: `${state.file}, one of pawl's own rules for Biome, is ${state.status === 'missing' ? 'missing' : 'out of date'}.`,
        fix: 'Run "pawl sync".'
      })
    }

    if (!empty && config.status !== 'missing') {
      findings.push(...(await runEngine('biome', () => runBiome({ root, ...scope, write }), setup, commands)))
    }
  }

  if (tools.linter === 'oxlint') {
    engines.push('oxlint')

    const config = checkOxlintConfig(root, policy, oxlintContextFor(detection))

    if (config.issue) setup.push(config.issue)

    if (!oxlintInstalled(root)) {
      setup.push({
        code: 'oxlint-missing',
        message: 'This project lints with Oxlint, but Oxlint is not installed.',
        fix: 'Add oxlint to devDependencies.'
      })
    } else if (!empty && config.status !== 'missing') {
      findings.push(...(await runEngine('oxlint', () => runOxlint({ root, ...scope, write }), setup, commands)))
    }
  }

  if (tools.eslint) {
    engines.push('eslint')

    if (!eslintInstalled(root)) {
      setup.push({
        code: 'eslint-missing',
        message: 'This project is set up to run ESLint, but ESLint is not installed.',
        fix: 'Add eslint to devDependencies.'
      })
    } else if (!empty) {
      findings.push(...(await runEngine('eslint', () => runEslint({ root, ...scope, write }), setup, commands)))
    }
  }

  if (tools.formatter === 'prettier') {
    const config = checkPrettierConfig(root, policy)

    if (config.issue) setup.push(config.issue)

    if (!prettierInstalled(root)) {
      setup.push({
        code: 'prettier-missing',
        message: 'This project formats with Prettier, but Prettier is not installed.',
        fix: 'Add prettier to devDependencies.'
      })
    } else if (!empty) {
      findings.push(...(await runEngine('prettier', () => runPrettier({ root, ...scope, write }), setup, commands)))
    }
  }

  // Pawl's own checks for the files no engine reads.
  if (!empty) {
    const own = { root, policy, ignores: detection.ignores, ...scope }

    findings.push(...checkDocker(own), ...checkMarkdown(own))

    // The other languages the policy names, each with its own tools.
    const languages = await checkLanguages({ root, policy, detection, ignored, write, ...scope })

    engines.push(...languages.engines)
    commands.push(...languages.commands)
    setup.push(...languages.setup)
    findings.push(...languages.findings)
  }

  const maxWarnings = lowerLimit(options.maxWarnings, policy.maxWarnings)
  const limit = maxWarnings === undefined ? {} : { maxWarnings }

  // The policy's ignore list applies at once, even before the engine config is synced.
  const kept = findings.filter(finding => !ignored(finding.file))
  const suppressions = empty ? [] : scanSuppressions(root, ignored, files)

  // Part of the check did not run, so what it found is not the whole picture of the code.
  const incomplete = setup.some(issue => BLOCKING.includes(issue.code))

  if (options.updateBaseline) {
    // A baseline recorded without, say, Clippy would forget every Rust finding it allowed.
    if (!incomplete) writeBaseline(root, createBaseline(kept, suppressions))

    return {
      findings: [],
      baselined: kept.length,
      setup,
      engines,
      commands,
      hasBaseline: true,
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
    // A partial run cannot tell whether findings elsewhere are gone, nor can a run where an engine failed.
    canShrinkBaseline: files === undefined && !incomplete && canShrink,
    nothingToCheck: empty,
    ...limit
  }
}
