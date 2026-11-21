import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPack, onlyWhenNamed, suggestedPacks } from '../catalog/packs.ts'
import { BASELINE_FILE } from '../check/baseline.ts'
import { check } from '../check/check.ts'
import { BLOCKING } from '../check/result.ts'
import { runBiome } from '../engines/biome/run.ts'
import { loadProject } from '../policy/project.ts'
import { ESLINT_CONFIG_FILES, hasAny } from '../project/config-files.ts'
import { type Detection, describe, filePacks, needsEslint } from '../project/detect.ts'
import { type EngineName, type FormatterName, type Policy, type PolicyInput } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { plural } from '../utils/text.ts'
import { PACKAGE_NAME } from '../version.ts'
import { planEngineConfigs } from './engine-configs.ts'
import { installCommand, listed } from './install.ts'
import { planAgents, planEditor, planHook, planScripts, planTurboTasks, planWorkflow } from './integrations.ts'
import { assertPacks, describeActions, planPolicyFile, type SetupAction, type SetupPlan } from './plan.ts'
import { ESLINT_CONFIG } from './templates.ts'

/**
 * How `pawl init` treats the tools a repo already has.
 * - `auto`: add Biome for lint and format, and leave an existing ESLint setup in place.
 * - `keep`: stay on the engine the repo uses today.
 * - `biome`: Biome only.
 */
export type InitMode = 'auto' | 'keep' | 'biome'

export interface InitOptions {
  root: string
  mode?: InitMode
  /** Write editor settings. On by default. */
  editor?: boolean
  /** Add a GitHub Actions workflow. */
  workflow?: boolean
  /** Add a hook so coding agents get findings after each edit, and instructions in AGENTS.md. */
  agents?: boolean
  /** Add a pre-commit hook that checks the changed files. */
  hooks?: boolean
  /** The linter to use, whatever the mode would pick. */
  engine?: EngineName
  /** The formatter to use, whatever the mode would pick. */
  formatter?: FormatterName
  /** Optional packs to switch on. Their ESLint plugins are added to the install. */
  packs?: readonly string[]
  /**
   * The caller will run the install command. On by default.
   * When off, pawl is written into devDependencies for the next install to pick up.
   */
  install?: boolean
}

export interface InitPlan extends SetupPlan {
  mode: InitMode
  /** The linters that will run, the main one first. */
  engines: EngineName[]
  formatter: FormatterName
}

interface Choice {
  linter: EngineName
  formatter: FormatterName
  /** ESLint runs: as the linter, for the packs, or for what Biome cannot lint yet. */
  eslint: boolean
}

/** The tools for a project: what the options name, else what the mode keeps or brings in. */
const chooseTools = (options: InitOptions, detection: Detection): Choice => {
  const { mode = 'auto' } = options
  const { tools } = detection
  const keep = mode === 'keep' && !tools.biome
  const kept: EngineName | undefined = (tools.oxlint && 'oxlint') || (tools.eslint && 'eslint') || undefined
  const linter: EngineName = options.engine ?? (keep && kept ? kept : 'biome')
  const formatter: FormatterName = options.formatter ?? (keep && tools.prettier ? 'prettier' : 'biome')
  const eslint =
    linter === 'eslint' ||
    (options.packs?.length ?? 0) > 0 ||
    (mode !== 'biome' && (tools.eslint !== undefined || needsEslint(detection)))

  return { linter, formatter, eslint }
}

/** What the policy file must say for the choice to stick: only what pawl would not work out by itself. */
const pinnedChoice = (root: string, choice: Choice, detection: Detection, packs: readonly string[]): PolicyInput => {
  const pinned: PolicyInput = {}

  if (choice.linter !== 'biome') pinned.engine = choice.linter
  else if (hasAny(root, ESLINT_CONFIG_FILES) && !choice.eslint) pinned.engine = 'biome'

  if (choice.formatter === 'prettier') pinned.formatter = 'prettier'
  else if (choice.linter !== 'biome' && detection.tools.prettier) pinned.formatter = 'biome'

  if (packs.length > 0) pinned.packs = [...packs]

  return pinned
}

/** An ESLint config built from the policy, or a note on the config the project already has. */
const planEslintConfig = (
  root: string,
  choice: Choice,
  detection: Detection,
  notes: string[]
): SetupAction | undefined => {
  const file = detection.tools.eslint

  if (!choice.eslint) {
    if (file) notes.push(`Pawl no longer runs ESLint here. You can remove ESLint and ${file} when you are ready.`)

    return undefined
  }

  if (!file) {
    return {
      path: 'eslint.config.js',
      kind: 'create',
      summary: choice.linter === 'eslint' ? 'the pawl standard for ESLint' : 'ESLint for what Biome does not cover',
      apply: () => writeText(join(root, 'eslint.config.js'), ESLINT_CONFIG)
    }
  }

  if (!hasAny(root, ESLINT_CONFIG_FILES)) {
    notes.push(`${file} is a legacy ESLint config. Pawl works with flat config (eslint.config.js) and left it alone.`)
  } else if (!readFileSync(join(root, file), 'utf8').includes(PACKAGE_NAME)) {
    notes.push(
      `Your ${file} is unchanged. To put ESLint under the pawl standard and its packs, export eslint() from ${PACKAGE_NAME} in it.`
    )
  }

  return undefined
}

/** What has to be installed: pawl, the chosen tools, and the plugin of every requested pack, less what is listed. */
const missingPackages = (
  root: string,
  choice: Choice,
  detection: Detection,
  packs: readonly string[],
  present: ReadonlySet<string>
): string[] => {
  if (!existsSync(join(root, 'package.json'))) return []

  const { linter, formatter } = choice
  const wanted = [
    PACKAGE_NAME,
    ...(linter === 'biome' || formatter === 'biome' ? ['@biomejs/biome'] : []),
    ...(linter === 'oxlint' ? ['oxlint'] : []),
    ...(choice.eslint ? ['eslint'] : []),
    ...(linter === 'eslint' ? ['@eslint/js', ...(detection.typescript ? ['typescript-eslint'] : [])] : []),
    ...(formatter === 'prettier' ? ['prettier'] : []),
    ...packs.flatMap(name => getPack(name)?.plugin ?? [])
  ]

  return [...new Set(wanted)].filter(name => !present.has(name))
}

/** The optional packs that fit what the project depends on and the files it has, and that it does not use yet. */
const packSuggestions = (
  detection: Detection,
  policy: Policy,
  requested: readonly string[],
  present: ReadonlySet<string>
): string | undefined => {
  const fit = [
    ...suggestedPacks(new Set(detection.dependencies)),
    ...filePacks(detection).flatMap(name => getPack(name) ?? [])
  ].filter(
    (pack, index, all) =>
      all.indexOf(pack) === index &&
      !requested.includes(pack.name) &&
      !policy.packs.includes(pack.name) &&
      !present.has(pack.plugin)
  )

  if (fit.length === 0) return undefined

  const names = fit.map(pack => pack.name).join(' ')

  return `Optional packs that fit this project: ${names}. Each needs an ESLint plugin. Add them with "pawl add ${names}".`
}

/** Work out everything `init` would do, without touching the disk. */
export const planInit = async (options: InitOptions): Promise<InitPlan> => {
  const {
    root,
    mode = 'auto',
    editor = true,
    workflow = false,
    agents = false,
    hooks = false,
    install = true
  } = options
  const requested = [...(options.packs ?? [])]

  assertPacks(requested)

  const { policy: loaded, detection } = await loadProject(root)
  const { tools } = detection
  const choice = chooseTools(options, detection)
  const { linter, formatter } = choice
  const named = requested.filter(name => onlyWhenNamed(name) && !loaded.packs.includes(name))
  const pinned = pinnedChoice(root, choice, detection, named.length > 0 ? [...loaded.packs, ...named] : [])
  const policy: Policy = {
    ...loaded,
    ...(pinned.engine ? { engine: pinned.engine } : {}),
    ...(pinned.formatter ? { formatter: pinned.formatter } : {}),
    packs: [...new Set([...loaded.packs, ...named])]
  }
  const notes: string[] = []
  const actions: (SetupAction | undefined)[] = [
    planPolicyFile(root, pinned, notes),
    ...planEngineConfigs(root, policy, detection, choice, notes, { updatePrettier: false })
  ]

  if (formatter !== 'prettier' && tools.prettier)
    notes.push(`Biome now formats the code. You can remove Prettier and ${tools.prettier} when you are ready.`)

  actions.push(planEslintConfig(root, choice, detection, notes))

  if (tools.oxlint && linter !== 'oxlint') {
    notes.push(
      `Found ${tools.oxlint}. Pawl leaves it alone. Choose Oxlint as the linter (--engine oxlint) to have pawl manage it.`
    )
  }

  const present = listed(root)
  const packages = missingPackages(root, choice, detection, requested, present)
  const suggestion = packSuggestions(detection, policy, requested, present)

  if (suggestion) notes.push(suggestion)

  actions.push(planScripts(root, notes, install ? [] : packages), planTurboTasks(root, notes))

  if (editor) actions.push(...planEditor(root, formatter, notes))

  if (workflow) actions.push(planWorkflow(root, detection))

  if (agents) actions.push(...planAgents(root, notes))

  if (hooks) actions.push(planHook(root, detection, notes))

  const count = detection.workspace.packages.length

  if (count > 0) notes.push(`Monorepo: pawl runs once from the root and covers all ${plural(count, 'package')}.`)

  return {
    detection,
    mode,
    engines: [...(linter === 'eslint' ? [] : [linter]), ...(choice.eslint ? (['eslint'] as const) : [])],
    formatter,
    actions: actions.filter((action): action is SetupAction => action !== undefined),
    notes,
    install: install && packages.length > 0 ? installCommand(detection, packages) : undefined,
    packages,
    policy
  }
}

/**
 * Format the files a plan wrote, so pawl's own output passes its own check.
 * Best effort: it needs the engine, which may not be installed yet.
 */
export const formatWritten = async (root: string, paths: readonly string[]): Promise<void> => {
  const files = paths.filter(path => /\.(?:jsonc?|[cm]?[jt]s)$/.test(path) && existsSync(join(root, path)))

  if (files.length === 0) return

  try {
    await runBiome({ root, files, write: true })
  } catch {
    // The files are valid either way; they will be formatted by the first "pawl fix".
  }
}

/**
 * Record the baseline so existing findings do not fail the first check.
 * Needs pawl installed in the project, because the engine configs point at it.
 * Returns the number of findings recorded, or undefined when a baseline already exists.
 */
export const recordBaseline = async (root: string, plan: InitPlan): Promise<number | undefined> => {
  if (existsSync(join(root, BASELINE_FILE))) return undefined

  const result = await check({ root, updateBaseline: true, policy: plan.policy })
  const failure = result.setup.find(issue => BLOCKING.includes(issue.code))

  if (failure) throw new Error(failure.message)

  return result.baselined
}

/** Describe a plan for people. The header is left out when a menu has already shown it. */
export const describePlan = (plan: InitPlan, { header = true }: { header?: boolean } = {}): string[] => {
  const names: Record<EngineName, string> = { biome: 'Biome', oxlint: 'Oxlint', eslint: 'ESLint' }
  const tools = Object.entries(plan.detection.tools).map(([tool, file]) => `${tool} (${file})`)
  const lines: string[] = []

  if (header) {
    lines.push(`Detected: ${describe(plan.detection)}`)

    if (tools.length > 0) lines.push(`Found:    ${tools.join(', ')}`)
  }

  const linters = plan.engines.map(engine => names[engine]).join(' + ') || 'none'

  lines.push(`Lint:     ${linters}`, `Format:   ${plan.formatter === 'biome' ? 'Biome' : 'Prettier'}`, '')

  lines.push(...describeActions(plan.actions))

  if (plan.actions.length === 0) lines.push('Nothing to change. This repo is already set up.')

  return lines
}
