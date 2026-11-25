import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Detection } from '../../project/detect.ts'
import { listFiles } from '../../project/files.ts'
import { LANGUAGE_INFO, type Language, type LanguageProject } from '../../project/languages.ts'
import { levelForFile } from '../../scans/scan.ts'
import { type Finding, type LanguageEngine, type LanguageTools, type Policy, type SetupIssue } from '../../types.ts'
import { EngineError, findOnPath } from '../engine.ts'
import { runClippy, runRustfmt } from './cargo.ts'
import { runKtlint } from './ktlint.ts'
import { runSwiftFormat, runSwiftLint, swiftFormatterFor } from './swift.ts'
import { type LanguageResult, type LanguageRun, ToolMissingError } from './tool.ts'

type Runner = (run: LanguageRun) => Promise<LanguageResult>

interface Tool {
  engine: LanguageEngine
  /** The tool's name for people. */
  title: string
  run: Runner
  /** The programs that provide it, any one of which will do. */
  programs: readonly string[]
  /** Clippy builds the whole Cargo project; the others take a list of files. */
  wholeProject?: boolean
}

/** The linter and formatter of each language. ktlint does both, so Kotlin has no formatter of its own. */
const TOOLS: Record<Language, { lint: Tool; format?: Tool }> = {
  rust: {
    lint: { engine: 'clippy', title: 'Clippy', run: runClippy, programs: ['cargo-clippy'], wholeProject: true },
    format: { engine: 'rustfmt', title: 'rustfmt', run: runRustfmt, programs: ['cargo-fmt'], wholeProject: true }
  },
  swift: {
    lint: { engine: 'swiftlint', title: 'SwiftLint', run: runSwiftLint, programs: ['swiftlint'] },
    format: {
      engine: 'swiftformat',
      title: 'SwiftFormat or swift-format',
      run: runSwiftFormat,
      programs: ['swiftformat', 'swift-format', 'swift']
    }
  },
  kotlin: { lint: { engine: 'ktlint', title: 'ktlint', run: runKtlint, programs: ['ktlint'] } }
}

/**
 * Each tool that runs for a language, and whether it is on the PATH. Reads the file system only.
 * With a project, the Swift formatter is the one that project uses, by the config it has.
 */
export const toolStates = (
  language: Language,
  tools: LanguageTools,
  project?: { root: string; dir: string }
): { name: string; installed: boolean }[] =>
  toolsFor(language, tools).map(tool => {
    if (tool.engine !== 'swiftformat' || !project) {
      return { name: tool.title, installed: tool.programs.some(program => findOnPath(program) !== undefined) }
    }

    try {
      const formatter = swiftFormatterFor(project.root, project.dir)

      return { name: formatter.engine === 'swiftformat' ? 'SwiftFormat' : 'swift-format', installed: true }
    } catch {
      const config = (name: string): boolean => existsSync(join(project.root, project.dir, name))
      const uses = (config('.swift-format') && 'swift-format') || (config('.swiftformat') && 'SwiftFormat')

      return { name: uses || tool.title, installed: false }
    }
  })

/** The tools that run for one language under a policy, linter first. */
export const toolsFor = (language: Language, tools: LanguageTools): Tool[] => {
  const { lint, format } = TOOLS[language]

  // ktlint lints and formats in one run, so either choice runs it.
  if (!format) return tools.lint || tools.format ? [lint] : []

  return [...(tools.lint ? [lint] : []), ...(tools.format ? [format] : [])]
}

/** The projects pawl checks: those in a language the policy names. */
export const checkedProjects = (policy: Policy, detection: Detection): LanguageProject[] =>
  detection.languages.filter(project => policy.languages[project.language] !== undefined)

export interface LanguageCheckOptions {
  root: string
  policy: Policy
  detection: Detection
  /** Only these files, relative to the root and already past the ignores. Undefined means every file. */
  files?: readonly string[]
  /** Cached project files to reuse when checking the whole project without narrowing tool.wholeProject. */
  projectFiles?: readonly string[]
  /** True for a file pawl skips. */
  ignored: (file: string) => boolean
  write?: boolean
}

export interface LanguageCheckResult {
  findings: Finding[]
  commands: string[]
  setup: SetupIssue[]
  engines: LanguageEngine[]
}

const extensionOf = (file: string): string => file.slice(file.lastIndexOf('.') + 1)

const under = (file: string, dir: string): boolean => dir === '' || file.startsWith(`${dir}/`)

/**
 * The files of one project in its language, relative to the project's folder. A crate inside
 * it that is a project of its own keeps its files.
 */
const projectFiles = (
  project: LanguageProject,
  files: readonly string[],
  projects: readonly LanguageProject[]
): string[] => {
  const prefix = project.dir ? `${project.dir}/` : ''
  const extensions = LANGUAGE_INFO[project.language].extensions
  const nested = projects.filter(
    other => other !== project && other.language === project.language && under(other.dir, project.dir)
  )

  return files.flatMap(file =>
    under(file, project.dir) && extensions.includes(extensionOf(file)) && !nested.some(other => under(file, other.dir))
      ? [file.slice(prefix.length)]
      : []
  )
}

/**
 * The level the policy gives a rule of another language's tool, for this file. These tools run
 * with the project's own config, so pawl applies the policy's levels to what they report:
 * `off` drops a finding, `warn` and `error` set its severity.
 */
const withLevels = (policy: Policy, findings: readonly Finding[]): Finding[] =>
  findings.flatMap(finding => {
    // What the tool reported stands unless the policy, or an override for the file, says otherwise.
    const level = levelForFile(policy, finding.rule, finding.file, finding.severity)

    return level === 'off' ? [] : [{ ...finding, severity: level }]
  })

/**
 * Check the projects in the languages the policy names, each with its own tools and config.
 * A tool that is not installed, or that fails, is a setup problem: never a pass.
 */
export const checkLanguages = async (options: LanguageCheckOptions): Promise<LanguageCheckResult> => {
  const { root, policy, detection, write = false } = options
  const result: LanguageCheckResult = { findings: [], commands: [], setup: [], engines: [] }
  const projects = checkedProjects(policy, detection)

  if (projects.length === 0) return result

  const all = options.files ?? (options.projectFiles ?? listFiles(root)).filter(file => !options.ignored(file))

  for (const project of projects) {
    const files = projectFiles(project, all, projects)

    // Nothing of this project is in the files asked for, or it has no code yet.
    if (files.length === 0) continue

    const tools = toolsFor(project.language, policy.languages[project.language] as LanguageTools)
    const lint = tools.find(tool => tool === TOOLS[project.language].lint)
    const format = tools.find(tool => tool !== lint)
    const step = (tool: Tool | undefined, fix: boolean, report: boolean) => (tool ? [{ tool, fix, report }] : [])
    // With fixes: format, then fix and lint, then check the formatting again, so the report is of the final code.
    const runs = write
      ? [...step(format, true, false), ...step(lint, true, true), ...step(format, false, true)]
      : [...step(lint, false, true), ...step(format, false, true)]

    for (const { tool, fix, report } of runs) {
      try {
        const ran = await tool.run({
          root,
          dir: project.dir,
          ...(tool.wholeProject && !options.files ? {} : { files }),
          write: fix
        })
        const engine = ran.engine ?? tool.engine

        if (!result.engines.includes(engine)) result.engines.push(engine)

        result.commands.push(...ran.commands.filter(command => !result.commands.includes(command)))

        if (report) result.findings.push(...withLevels(policy, ran.findings))
      } catch (error) {
        // A program that cannot start, such as one without the right to run, is an EngineError too.
        if (!(error instanceof ToolMissingError) && !(error instanceof EngineError)) throw error

        const issue: SetupIssue =
          error instanceof ToolMissingError
            ? { code: 'language-tool-missing', message: error.message, fix: LANGUAGE_INFO[project.language].install }
            : {
                code: 'engine-failed',
                message: `${tool.engine} could not run in ${project.dir || 'the root'}: ${error.message}`
              }

        // Without cargo, Clippy and rustfmt fail the same way; one problem says it.
        if (!result.setup.some(known => known.message === issue.message)) result.setup.push(issue)
      }
    }
  }

  return result
}
