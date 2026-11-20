import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getGuard } from '../catalog/guards.ts'
import { getPack, PACKS, suggestedPacks } from '../catalog/packs.ts'
import { BASELINE_FILE } from '../check/baseline.ts'
import { BLOCKING, check } from '../check/check.ts'
import {
  BIOME_PRESET,
  BIOME_VERSION,
  type BiomeContext,
  biomeContextFor,
  biomeProjectConfig,
  checkBiomeConfig,
  checkBiomePackages,
  checkRuleFiles,
  runBiome,
  syncBiomeGlobals
} from '../engines/biome/config.ts'
import { checkOxlintConfig, mergeOxlintConfig, oxlintConfig, oxlintContextFor } from '../engines/oxlint/config.ts'
import { OXLINT_VERSION } from '../engines/oxlint/rules.ts'
import { checkPrettierConfig, prettierConfig } from '../engines/prettier/config.ts'
import { findConfigFile, loadPolicy } from '../policy/load.ts'
import {
  ESLINT_CONFIG_FILES,
  firstExisting,
  hasAny,
  LEFTHOOK_CONFIG_FILES,
  OXLINT_CONFIG_FILE
} from '../project/config-files.ts'
import {
  type Detection,
  describe,
  detect,
  filePacks,
  needsEslint,
  type PackageManager,
  packageTechnologies
} from '../project/detect.ts'
import { type EngineName, type FormatterName, type Policy, type PolicyInput } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { isRecord, type JsonRecord, mergeDeep, readJson, readJsonc, sameJson, writeJson } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { plural } from '../utils/text.ts'
import { PACKAGE_NAME, VERSION } from '../version.ts'

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

export interface InitAction {
  path: string
  kind: 'create' | 'update'
  summary: string
  apply: () => void
}

export interface InitPlan {
  detection: Detection
  mode: InitMode
  engines: EngineName[]
  actions: InitAction[]
  /** Things the user should know or do by hand. */
  notes: string[]
  formatter: FormatterName
  /** The command that installs pawl and the chosen tools, when something is missing. */
  install: string | undefined
  /** The packages that command installs. */
  packages: string[]
  /** The policy the plan was made for, including an engine the plan pins. */
  policy: Policy
}

const INSTALL: Record<PackageManager, string> = {
  pnpm: 'pnpm add -D',
  npm: 'npm install -D',
  yarn: 'yarn add -D',
  bun: 'bun add -d'
}

/** Version ranges pawl writes into package.json when it does not run the package manager itself. */
const TOOL_RANGES: Record<string, string> = {
  [PACKAGE_NAME]: `^${VERSION}`,
  '@biomejs/biome': BIOME_VERSION,
  eslint: '^10.0.0',
  oxlint: OXLINT_VERSION,
  '@eslint/js': '^10.0.0',
  'typescript-eslint': '^8.0.0',
  prettier: '^3.0.0'
}

const rangeFor = (name: string): string => {
  const known = TOOL_RANGES[name]

  if (known) return known

  const major = /(\d+)/.exec(PACKS.find(pack => pack.plugin === name)?.range ?? '')?.[1]

  return major ? `^${major}.0.0` : '*'
}

/** The command that adds packages to the project with its own package manager. */
export const installCommand = (detection: Detection, packages: readonly string[] = [PACKAGE_NAME]): string => {
  const manager = detection.packageManager ?? 'npm'
  const workspaceFlag = manager === 'pnpm' && detection.workspace.packages.length > 0 ? ' -w' : ''
  // Biome is pinned: pawl reads a report format Biome may change between releases.
  const specs = packages.map(name => (name === '@biomejs/biome' ? `${name}@${BIOME_VERSION}` : name))

  return `${INSTALL[manager]}${workspaceFlag} ${specs.join(' ')}`
}

/** Join two `extends` lists, keeping the order and dropping repeats. */
const mergeExtends = (first: unknown, second: unknown): unknown[] => [...new Set([...toList(first), ...toList(second)])]

/** Bring biome.json in line with the policy. Used by both `init` and `sync`. */
export const planBiomeConfig = (
  root: string,
  policy: Policy,
  context: BiomeContext,
  notes: string[]
): InitAction | undefined => {
  const state = checkBiomeConfig(root, policy, context)
  const file = state.file ?? 'biome.json'
  const path = join(root, file)

  if (state.status === 'ok') return undefined

  if (state.status === 'missing') {
    return {
      path: file,
      kind: 'create',
      summary: 'the pawl standard for Biome',
      apply: () => writeJson(path, biomeProjectConfig(policy, context))
    }
  }

  const { value, hasComments } = readJsonc<JsonRecord>(path)

  if (!value || hasComments) {
    notes.push(
      `${file} has comments or could not be read, so pawl left it alone. Add "${BIOME_PRESET}" to its "extends" by hand.`
    )

    return undefined
  }

  const expected = biomeProjectConfig(policy, context, state.preset ?? BIOME_PRESET)

  if (state.status === 'stale') {
    return {
      path: file,
      kind: 'update',
      summary: 'bring it in line with the policy',
      apply: () =>
        writeJson(
          path,
          syncBiomeGlobals(
            { ...mergeDeep(value, expected), extends: mergeExtends(expected.extends, value.extends) },
            expected
          )
        )
    }
  }

  notes.push(
    `Your existing ${file} settings still override the standard. Remove the ones you no longer need to adopt it fully.`
  )

  return {
    path: file,
    kind: 'update',
    summary: 'extend the pawl standard, keeping your settings on top',
    apply: () => writeJson(path, { ...value, extends: mergeExtends(expected.extends, value.extends) })
  }
}

/** In a monorepo, give each package that needs it a biome.json with its own technology's rules. */
/** Write the files of pawl's own Biome rules that are missing or out of date. */
export const planRuleFiles = (
  root: string,
  policy: Policy,
  context: BiomeContext,
  detection: Detection
): InitAction[] =>
  checkRuleFiles(root, policy, context, Object.keys(packageTechnologies(detection))).flatMap(state =>
    state.status === 'ok'
      ? []
      : [
          {
            path: state.file,
            kind: state.status === 'missing' ? ('create' as const) : ('update' as const),
            summary: "one of pawl's own rules, for Biome",
            apply: () => writeText(join(root, state.file), state.content)
          }
        ]
  )

export const planBiomePackages = (
  root: string,
  detection: Detection,
  notes: string[],
  preset?: string
): InitAction[] => {
  const rootFile = detection.tools.biome ?? 'biome.json'
  const actions: InitAction[] = []

  for (const state of checkBiomePackages(root, packageTechnologies(detection), rootFile, preset)) {
    const path = join(root, state.file)
    const rules = (packageTechnologies(detection)[state.dir] ?? []).join(', ')

    if (state.status === 'ok') continue

    if (state.status === 'missing') {
      actions.push({
        path: state.file,
        kind: 'create',
        summary: `${rules} rules for this package only`,
        apply: () => writeJson(path, state.expected)
      })
    } else if (state.status === 'stale' && state.current) {
      const current = state.current

      actions.push({
        path: state.file,
        kind: 'update',
        summary: `add the ${rules} rules`,
        apply: () => writeJson(path, { ...current, extends: mergeExtends(current.extends, state.expected.extends) })
      })
    } else {
      notes.push(
        `${state.file} has comments or could not be read, so pawl left it alone. It should extend ${JSON.stringify(state.expected.extends)}.`
      )
    }
  }

  return actions
}

/** The ESLint config pawl writes. The root is the config file's folder, wherever ESLint is started from. */
export const ESLINT_CONFIG = `import { eslint } from '${PACKAGE_NAME}'

export default eslint({ root: import.meta.dirname })
`

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

const INLINE_WIDTH = 80

/** Write a value as source code in the pawl style: single quotes, no trailing commas, two spaces. */
const toSource = (value: unknown, depth: number): string => {
  const pad = '  '.repeat(depth + 1)
  const close = '  '.repeat(depth)

  if (Array.isArray(value)) {
    const items = value.map(item => toSource(item, depth + 1))
    const inline = `[${items.join(', ')}]`

    return inline.length <= INLINE_WIDTH ? inline : `[\n${items.map(item => pad + item).join(',\n')}\n${close}]`
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${pad}${IDENTIFIER.test(key) ? key : toSource(key, 0)}: ${toSource(item, depth + 1)}`
    )

    return entries.length > 0 ? `{\n${entries.join(',\n')}\n${close}}` : '{}'
  }

  return typeof value === 'string' ? `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'` : String(value)
}

/** The source of a policy file for a policy. */
export const policyFile = (policy: PolicyInput): string =>
  `import { definePolicy } from '${PACKAGE_NAME}'\n\nexport default definePolicy(${toSource(policy, 0)})\n`

/** The actions the workflow uses, pinned by commit so a moved tag cannot change what runs. */
const ACTIONS = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  setupNode: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  uploadArtifact: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
  setupBun: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0'
}

/** The step that makes each package manager available on a GitHub runner. */
const WORKFLOW_SETUP: Record<PackageManager, string> = {
  npm: '',
  bun: `      - uses: ${ACTIONS.setupBun}\n`,
  pnpm: '      - run: npm install --global corepack@latest && corepack enable\n',
  yarn: '      - run: npm install --global corepack@latest && corepack enable\n'
}

/**
 * The GitHub workflow: the check on every pull request, then the doctor's report as an artifact,
 * which shows the tool versions and any drift even when the check fails.
 */
export const workflowFile = (manager: PackageManager): string => {
  const install = manager === 'npm' ? 'npm ci' : `${manager} install --frozen-lockfile`
  const setup = WORKFLOW_SETUP[manager]

  return `name: pawl

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ${ACTIONS.checkout}
      - uses: ${ACTIONS.setupNode}
        with:
          node-version: 22
${setup}      - run: ${install}
      - run: npx pawl check --ci
      - name: Check the setup and the tool versions
        if: always()
        run: npx pawl doctor --format json > pawl-doctor.json
      - name: Upload the doctor report
        if: always()
        uses: ${ACTIONS.uploadArtifact}
        with:
          name: pawl-doctor
          path: pawl-doctor.json
          if-no-files-found: warn
`
}

/** Add the check and fix scripts, and, when pawl is not running the install, the packages to install. */
const planScripts = (root: string, notes: string[], packages: readonly string[]): InitAction | undefined => {
  const path = join(root, 'package.json')
  const manifest = readJson<JsonRecord>(path)

  if (!manifest) {
    notes.push('No package.json here, so pawl added no scripts. Run "npx pawl check" directly.')

    return undefined
  }

  const scripts = isRecord(manifest.scripts) ? { ...manifest.scripts } : {}
  const added: string[] = []

  for (const [name, command] of [
    ['check', 'pawl check'],
    ['fix', 'pawl fix']
  ] as const) {
    if (Object.values(scripts).includes(command)) continue

    const key = scripts[name] === undefined ? name : `pawl:${name}`

    if (scripts[key] !== undefined) continue

    scripts[key] = command
    added.push(key)
  }

  const devDependencies = isRecord(manifest.devDependencies) ? { ...manifest.devDependencies } : {}

  for (const name of packages) devDependencies[name] = rangeFor(name)

  // Under Nx, the root becomes a project whose check and fix scripts are targets, never cached:
  // pawl checks the whole repo in one run, and a cached result would hide new findings.
  const nx = isRecord(manifest.nx) ? manifest.nx : {}
  const targets: JsonRecord = isRecord(nx.targets) ? { ...nx.targets } : {}
  const nxTargets: string[] = []

  if (existsSync(join(root, 'nx.json'))) {
    for (const command of ['pawl check', 'pawl fix']) {
      const script = Object.keys(scripts).find(name => scripts[name] === command)

      if (script !== undefined && targets[script] === undefined) {
        targets[script] = { cache: false }
        nxTargets.push(script)
      }
    }
  }

  if (added.length === 0 && packages.length === 0 && nxTargets.length === 0) return undefined

  const parts = [
    added.length > 0 ? `scripts ${added.map(name => `"${name}"`).join(' and ')}` : '',
    nxTargets.length > 0 ? `Nx targets ${nxTargets.map(name => `"${name}"`).join(' and ')}` : '',
    packages.length > 0 ? `${packages.join(', ')} in devDependencies` : ''
  ]

  return {
    path: 'package.json',
    kind: 'update',
    summary: parts.filter(Boolean).join(', '),
    apply: () =>
      writeJson(path, {
        ...manifest,
        scripts,
        ...(packages.length > 0 ? { devDependencies } : {}),
        ...(nxTargets.length > 0 ? { nx: { ...nx, targets } } : {})
      })
  }
}

/**
 * In a Turborepo, make the check and fix scripts root tasks, so "turbo run check" runs pawl with the rest.
 * Pawl checks the whole repo in one run, so the tasks belong to the root and are never cached:
 * a cached lint result would hide new findings.
 */
const planTurboTasks = (root: string, notes: string[]): InitAction | undefined => {
  if (!existsSync(join(root, 'turbo.json'))) return undefined

  const { value } = readJsonc<JsonRecord>(join(root, 'turbo.json'))
  const manifest = readJson<JsonRecord>(join(root, 'package.json'))
  // Turborepo 2 calls them tasks. Version 1 called them a pipeline.
  const key = isRecord(value?.pipeline) ? 'pipeline' : 'tasks'

  if (!value || !manifest || !isRecord(value[key])) return undefined

  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {}
  const tasks: JsonRecord = {}

  for (const [name, command] of [
    ['check', 'pawl check'],
    ['fix', 'pawl fix']
  ] as const) {
    // The same name planScripts gives the script: an existing one, else the short name when it is free.
    const script =
      Object.keys(scripts).find(existing => scripts[existing] === command) ??
      (scripts[name] === undefined ? name : `pawl:${name}`)

    if (value[key][`//#${script}`] === undefined) tasks[`//#${script}`] = { cache: false }
  }

  if (Object.keys(tasks).length === 0) return undefined

  return planJsonMerge(
    root,
    'turbo.json',
    { [key]: tasks },
    `root tasks ${Object.keys(tasks)
      .map(name => `"${name}"`)
      .join(' and ')}`,
    notes
  )
}

const planJsonMerge = (
  root: string,
  file: string,
  patch: JsonRecord,
  summary: string,
  notes: string[]
): InitAction | undefined => {
  const path = join(root, file)

  if (!existsSync(path)) return { path: file, kind: 'create', summary, apply: () => writeJson(path, patch) }

  const { value, hasComments } = readJsonc<JsonRecord>(path)

  if (!value || hasComments) {
    notes.push(`${file} has comments or could not be read, so pawl left it alone.`)

    return undefined
  }

  const merged = mergeDeep(value, patch)

  return sameJson(merged, value)
    ? undefined
    : { path: file, kind: 'update', summary, apply: () => writeJson(path, merged) }
}

const EDITOR_SETTINGS: JsonRecord = {
  'editor.defaultFormatter': 'biomejs.biome',
  'editor.formatOnSave': true,
  'editor.codeActionsOnSave': {
    'source.fixAll.biome': 'explicit',
    'source.organizeImports.biome': 'explicit'
  }
}

const planAgentHook = (root: string, notes: string[]): InitAction | undefined => {
  const file = '.claude/settings.json'
  const path = join(root, file)
  const command = 'npx pawl check --changed --format agent'
  const existing = existsSync(path) ? readJsonc<JsonRecord>(path) : { value: {} as JsonRecord, hasComments: false }

  if (!existing.value || existing.hasComments) {
    notes.push(`${file} could not be read, so pawl added no agent hook.`)

    return undefined
  }

  if (JSON.stringify(existing.value).includes(command)) return undefined

  const hooks = isRecord(existing.value.hooks) ? existing.value.hooks : {}
  const postToolUse = Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : []
  const entry = { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command }] }

  return {
    path: file,
    kind: existsSync(path) ? 'update' : 'create',
    summary: 'hook that shows findings to Claude Code after each edit',
    apply: () => writeJson(path, { ...existing.value, hooks: { ...hooks, PostToolUse: [...postToolUse, entry] } })
  }
}

/**
 * A Cursor hook that applies safe fixes and formatting after each edit. Cursor does not read a
 * hook's findings back, so the hook fixes, and AGENTS.md tells the agent to run the check.
 */
const planCursorHook = (root: string, notes: string[]): InitAction | undefined => {
  // Only for repos that already use Cursor: no empty .cursor folder for everyone else.
  if (!existsSync(join(root, '.cursor'))) return undefined

  const file = '.cursor/hooks.json'
  const path = join(root, file)
  const command = 'npx pawl fix --changed'
  const existing = existsSync(path) ? readJsonc<JsonRecord>(path) : { value: {} as JsonRecord, hasComments: false }

  if (!existing.value || existing.hasComments) {
    notes.push(`${file} could not be read, so pawl added no Cursor hook.`)

    return undefined
  }

  if (JSON.stringify(existing.value).includes(command)) return undefined

  const hooks = isRecord(existing.value.hooks) ? existing.value.hooks : {}
  const afterFileEdit = Array.isArray(hooks.afterFileEdit) ? hooks.afterFileEdit : []

  return {
    path: file,
    kind: existsSync(path) ? 'update' : 'create',
    summary: 'hook that fixes and formats after each Cursor edit',
    apply: () =>
      writeJson(path, {
        version: 1,
        ...existing.value,
        hooks: { ...hooks, afterFileEdit: [...afterFileEdit, { command }] }
      })
  }
}

const AGENTS_START = '<!-- pawl:start -->'

const AGENTS_END = '<!-- pawl:end -->'

const AGENTS_BLOCK = `${AGENTS_START}
## Code quality

This repo uses pawl. After editing code, run:

    npx pawl check --changed --format agent

It prints one JSON line per problem, each with a \`fix\`. No output means there is nothing to do.
Run \`npx pawl fix\` to apply formatting and safe fixes.

Do not silence a problem with a disable comment (\`biome-ignore\`, \`eslint-disable\`, \`@ts-ignore\`).
New ones fail the check. Fix the code instead.
${AGENTS_END}
`

/** Instructions any coding agent can follow, kept in a marked block so they can be updated later. */
const planAgentsFile = (root: string): InitAction | undefined => {
  const path = join(root, 'AGENTS.md')

  if (!existsSync(path)) {
    return {
      path: 'AGENTS.md',
      kind: 'create',
      summary: 'how coding agents should check their work',
      apply: () => writeText(path, AGENTS_BLOCK)
    }
  }

  const current = readFileSync(path, 'utf8')
  const start = current.indexOf(AGENTS_START)
  const end = current.indexOf(AGENTS_END)
  const next =
    start !== -1 && end > start
      ? `${current.slice(0, start)}${AGENTS_BLOCK.trimEnd()}${current.slice(end + AGENTS_END.length)}`
      : `${current.trimEnd()}\n\n${AGENTS_BLOCK}`

  if (next === current) return undefined

  return {
    path: 'AGENTS.md',
    kind: 'update',
    summary: 'how coding agents should check their work',
    apply: () => writeText(path, next)
  }
}

const HOOK_COMMAND = 'npx pawl check --changed'

/** A pre-commit hook, through the hook manager the repo already uses. */
const planHook = (root: string, detection: Detection, notes: string[]): InitAction | undefined => {
  const husky = join(root, '.husky')

  if (existsSync(husky)) {
    const path = join(husky, 'pre-commit')
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''

    if (current.includes('pawl check')) return undefined

    return {
      path: '.husky/pre-commit',
      kind: current ? 'update' : 'create',
      summary: 'check changed files before each commit',
      apply: () => writeText(path, `${current.trimEnd()}${current ? '\n' : ''}${HOOK_COMMAND}\n`)
    }
  }

  const lefthook = firstExisting(root, LEFTHOOK_CONFIG_FILES)

  if (lefthook) {
    notes.push(`This repo uses lefthook. Add "${HOOK_COMMAND}" to the pre-commit commands in ${lefthook}.`)

    return undefined
  }

  if (!detection.git) {
    notes.push('This is not a git repository, so pawl added no pre-commit hook.')

    return undefined
  }

  const path = join(root, '.git/hooks/pre-commit')

  if (existsSync(path)) {
    notes.push(`A pre-commit hook already exists. Add "${HOOK_COMMAND}" to .git/hooks/pre-commit.`)

    return undefined
  }

  notes.push(
    'The pre-commit hook lives in .git/hooks, so it is local to this clone. Use husky or lefthook to share it with the team.'
  )

  return {
    path: '.git/hooks/pre-commit',
    kind: 'create',
    summary: 'check changed files before each commit',
    apply: () => {
      writeText(path, `#!/bin/sh\n${HOOK_COMMAND}\n`)
      chmodSync(path, 0o755)
    }
  }
}

const PRETTIER_EDITOR_SETTINGS: JsonRecord = {
  'editor.defaultFormatter': 'esbenp.prettier-vscode',
  'editor.formatOnSave': true
}

/** The packages a project already lists, in any dependency group. */
const listed = (root: string): Set<string> => {
  const manifest = readJson<Record<string, Record<string, string> | undefined>>(join(root, 'package.json'))

  return new Set(Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies }))
}

/** Names that are neither a pack nor one of the opt-in guards, which are asked for the same way. */
const unknownPacks = (names: readonly string[]): string[] =>
  names.filter(name => !getPack(name) && !getGuard(name)?.optIn)

/** Bring the Prettier config in line with the standard's style. Used by `init` and `sync`. */
export const planPrettierConfig = (
  root: string,
  policy: Policy,
  notes: string[],
  update: boolean
): InitAction | undefined => {
  const state = checkPrettierConfig(root, policy)
  const expected = prettierConfig(policy)

  if (state.status === 'missing') {
    return {
      path: '.prettierrc.json',
      kind: 'create',
      summary: "the standard's style for Prettier",
      apply: () => writeJson(join(root, '.prettierrc.json'), expected)
    }
  }

  if (state.status === 'unmanaged') {
    notes.push(
      `Your Prettier config in ${state.file} is unchanged. Pawl cannot read it, so it does not check it against the standard's style.`
    )

    return undefined
  }

  if (state.status !== 'stale' || !state.file) return undefined

  if (!update) {
    notes.push(`${state.issue?.message ?? ''} Your config is unchanged. Run "pawl sync" to adopt the standard's style.`)

    return undefined
  }

  const path = join(root, state.file)
  const current = readJsonc<JsonRecord>(path).value ?? {}

  return {
    path: state.file,
    kind: 'update',
    summary: "adopt the standard's style",
    apply: () => writeJson(path, { ...current, ...expected })
  }
}

/** Bring .oxlintrc.json in line with the policy. Used by `init` and `sync`. */
export const planOxlintConfig = (root: string, policy: Policy, detection: Detection): InitAction | undefined => {
  const context = oxlintContextFor(detection)
  const state = checkOxlintConfig(root, policy, context)
  const path = join(root, OXLINT_CONFIG_FILE)

  if (state.status === 'ok') return undefined

  const current = state.status === 'stale' ? (readJsonc<JsonRecord>(path).value ?? {}) : {}

  return {
    path: OXLINT_CONFIG_FILE,
    kind: state.status === 'missing' ? 'create' : 'update',
    summary: 'the pawl standard for Oxlint',
    // Keys pawl does not manage, such as "settings", stay as the project wrote them.
    apply: () => writeJson(path, mergeOxlintConfig(current, oxlintConfig(policy, context)))
  }
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
  const requestedPacks = [...(options.packs ?? [])]
  const unknown = unknownPacks(requestedPacks)

  if (unknown.length > 0) {
    throw new Error(
      `Unknown pack${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Packs: ${PACKS.map(pack => pack.name).join(', ')}.`
    )
  }

  // Only what differs from what pawl would work out by itself is written to the policy file.
  const loaded = await loadPolicy(root)
  const detection = detect(root, loaded)
  const { tools } = detection
  const actions: InitAction[] = []
  const notes: string[] = []
  const hasFlatEslint = hasAny(root, ESLINT_CONFIG_FILES)
  const keep = mode === 'keep' && !tools.biome
  const kept: EngineName | undefined = (tools.oxlint && 'oxlint') || (tools.eslint && 'eslint') || undefined
  const linter: EngineName = options.engine ?? (keep && kept ? kept : 'biome')
  const formatter: FormatterName = options.formatter ?? (keep && tools.prettier ? 'prettier' : 'biome')
  const wantsEslint =
    linter === 'eslint' ||
    requestedPacks.length > 0 ||
    (mode !== 'biome' && (tools.eslint !== undefined || needsEslint(detection)))
  const engines: EngineName[] = [
    ...(linter === 'eslint' ? [] : [linter]),
    ...(wantsEslint ? (['eslint'] as const) : [])
  ]

  const pinned: PolicyInput = {}

  if (linter !== 'biome') pinned.engine = linter
  else if (hasFlatEslint && !wantsEslint) pinned.engine = 'biome'

  if (formatter === 'prettier') pinned.formatter = 'prettier'
  else if (linter !== 'biome' && tools.prettier) pinned.formatter = 'biome'

  const namedPacks = requestedPacks.filter(
    name => (name.includes('/') || (getPack(name)?.when.length ?? 0) === 0) && !loaded.packs.includes(name)
  )

  if (namedPacks.length > 0) pinned.packs = [...loaded.packs, ...namedPacks]

  const policy: Policy = {
    ...loaded,
    ...(pinned.engine ? { engine: pinned.engine } : {}),
    ...(pinned.formatter ? { formatter: pinned.formatter } : {}),
    packs: [...new Set([...loaded.packs, ...namedPacks])]
  }
  const usesBiome = linter === 'biome' || formatter === 'biome'

  const push = (action: InitAction | undefined): void => {
    if (action) actions.push(action)
  }

  if (Object.keys(pinned).length > 0) {
    const file = findConfigFile(root)

    if (file) {
      notes.push(
        `Add ${JSON.stringify(pinned)} to ${file.slice(root.length + 1)}. Pawl does not edit a policy file you wrote.`
      )
    } else {
      push({
        path: 'pawl.config.ts',
        kind: 'create',
        summary: Object.entries(pinned)
          .map(([key, value]) => `${key}: ${toList(value as string | string[]).join(', ')}`)
          .join('; '),
        apply: () => writeText(join(root, 'pawl.config.ts'), policyFile(pinned))
      })
    }
  }

  if (usesBiome) {
    const context = biomeContextFor(root, policy, detection, { linter, formatter })

    push(planBiomeConfig(root, policy, context, notes))

    const { preset } = checkBiomeConfig(root, policy, context)

    for (const action of planBiomePackages(root, detection, notes, preset)) push(action)

    for (const action of planRuleFiles(root, policy, context, detection)) push(action)
  }

  if (linter === 'oxlint') push(planOxlintConfig(root, policy, detection))

  if (formatter === 'prettier') push(planPrettierConfig(root, policy, notes, false))
  else if (tools.prettier)
    notes.push(`Biome now formats the code. You can remove Prettier and ${tools.prettier} when you are ready.`)

  if (wantsEslint) {
    if (!tools.eslint) {
      push({
        path: 'eslint.config.js',
        kind: 'create',
        summary: linter === 'eslint' ? 'the pawl standard for ESLint' : 'ESLint for what Biome does not cover',
        apply: () => writeText(join(root, 'eslint.config.js'), ESLINT_CONFIG)
      })
    } else if (hasFlatEslint && readFileSync(join(root, tools.eslint), 'utf8').includes(PACKAGE_NAME)) {
      // The ESLint config is already built from the policy.
    } else if (hasFlatEslint) {
      notes.push(
        `Your ${tools.eslint} is unchanged. To put ESLint under the pawl standard and its packs, export eslint() from ${PACKAGE_NAME} in it.`
      )
    } else {
      notes.push(
        `${tools.eslint} is a legacy ESLint config. Pawl works with flat config (eslint.config.js) and left it alone.`
      )
    }
  } else if (tools.eslint) {
    notes.push(`Pawl no longer runs ESLint here. You can remove ESLint and ${tools.eslint} when you are ready.`)
  }

  if (tools.oxlint && linter !== 'oxlint') {
    notes.push(
      `Found ${tools.oxlint}. Pawl leaves it alone. Choose Oxlint as the linter (--engine oxlint) to have pawl manage it.`
    )
  }

  // What has to be installed: pawl, the chosen tools, and the plugin of every requested pack.
  const present = listed(root)
  const wanted = [
    PACKAGE_NAME,
    ...(usesBiome ? ['@biomejs/biome'] : []),
    ...(linter === 'oxlint' ? ['oxlint'] : []),
    ...(wantsEslint ? ['eslint'] : []),
    ...(linter === 'eslint' ? ['@eslint/js', ...(detection.typescript ? ['typescript-eslint'] : [])] : []),
    ...(formatter === 'prettier' ? ['prettier'] : []),
    ...requestedPacks.flatMap(name => getPack(name)?.plugin ?? [])
  ]
  const hasManifest = existsSync(join(root, 'package.json'))
  const packages = hasManifest ? [...new Set(wanted)].filter(name => !present.has(name)) : []
  const suggestions = [
    ...suggestedPacks(new Set(detection.dependencies)),
    ...filePacks(detection).flatMap(name => getPack(name) ?? [])
  ].filter(
    (pack, index, all) =>
      all.indexOf(pack) === index &&
      !requestedPacks.includes(pack.name) &&
      !policy.packs.includes(pack.name) &&
      !present.has(pack.plugin)
  )

  if (suggestions.length > 0) {
    const names = suggestions.map(pack => pack.name).join(' ')

    notes.push(
      `Optional packs that fit this project: ${names}. Each needs an ESLint plugin. Add them with "pawl add ${names}".`
    )
  }

  push(planScripts(root, notes, install ? [] : packages))
  push(planTurboTasks(root, notes))

  if (editor) {
    const settings = formatter === 'biome' ? EDITOR_SETTINGS : PRETTIER_EDITOR_SETTINGS
    const extension = formatter === 'biome' ? 'biomejs.biome' : 'esbenp.prettier-vscode'
    const name = formatter === 'biome' ? 'Biome' : 'Prettier'

    push(planJsonMerge(root, '.vscode/settings.json', settings, `format on save with ${name}`, notes))

    const current =
      readJsonc<{ recommendations?: string[] }>(join(root, '.vscode/extensions.json')).value?.recommendations ?? []

    if (!current.includes(extension)) {
      push(
        planJsonMerge(
          root,
          '.vscode/extensions.json',
          { recommendations: [...current, extension] },
          `recommend the ${name} extension`,
          notes
        )
      )
    }
  }

  if (workflow && !existsSync(join(root, '.github/workflows/pawl.yml'))) {
    push({
      path: '.github/workflows/pawl.yml',
      kind: 'create',
      summary: 'run "pawl check --ci" on every pull request and keep the doctor report',
      apply: () => writeText(join(root, '.github/workflows/pawl.yml'), workflowFile(detection.packageManager ?? 'npm'))
    })
  }

  if (agents) {
    push(planAgentHook(root, notes))
    push(planCursorHook(root, notes))
    push(planAgentsFile(root))
  }

  if (hooks) push(planHook(root, detection, notes))

  const count = detection.workspace.packages.length

  if (count > 0) {
    notes.push(`Monorepo: pawl runs once from the root and covers all ${plural(count, 'package')}.`)
  }

  return {
    detection,
    mode,
    engines,
    formatter,
    actions,
    notes,
    install: install && packages.length > 0 ? installCommand(detection, packages) : undefined,
    packages,
    policy
  }
}

/** Write every file in the plan. */
export const applyInit = (plan: Pick<InitPlan, 'actions'>): void => {
  for (const action of plan.actions) action.apply()
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

  for (const action of plan.actions)
    lines.push(`${action.kind === 'create' ? 'Write ' : 'Update'} ${action.path}  (${action.summary})`)

  if (plan.actions.length === 0) lines.push('Nothing to change. This repo is already set up.')

  return lines
}

/**
 * Work out what switching packs on takes: the ESLint plugins to install, an ESLint config if
 * the project has none, and the policy entry for packs that are opt-in only.
 */
export const planAdd = async (root: string, names: readonly string[], install = true): Promise<InitPlan> => {
  const unknown = unknownPacks(names)

  if (names.length === 0 || unknown.length > 0) {
    const problem =
      names.length === 0 ? 'Which pack?' : `Unknown pack${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`

    throw new Error(`${problem} Packs: ${PACKS.map(pack => pack.name).join(', ')}.`)
  }

  const loaded = await loadPolicy(root)
  const detection = detect(root, loaded)
  const actions: InitAction[] = []
  const notes: string[] = []

  // A guard asked for by name needs no plugin and no ESLint: the linter the project has runs it.
  const needsEslint = names.some(name => getPack(name) !== undefined)

  if (names.some(name => getGuard(name)?.optIn)) notes.push('Run "pawl sync" to switch the new guard on in the linter.')

  if (loaded.engine === 'biome' && needsEslint) {
    notes.push(
      'This repo is set to Biome only, so ESLint does not run and packs have no effect. Remove "engine" from the policy first.'
    )
  }

  if (!needsEslint) {
    // Nothing to set up.
  } else if (!detection.tools.eslint) {
    actions.push({
      path: 'eslint.config.js',
      kind: 'create',
      summary: 'ESLint for the packs',
      apply: () => writeText(join(root, 'eslint.config.js'), ESLINT_CONFIG)
    })
  } else if (hasAny(root, ESLINT_CONFIG_FILES)) {
    notes.push(
      `Packs apply through eslint() from ${PACKAGE_NAME}. Make sure your ${detection.tools.eslint} exports it or spreads it.`
    )
  } else {
    notes.push(`${detection.tools.eslint} is a legacy ESLint config. Packs need flat config (eslint.config.js).`)
  }

  const named = names.filter(
    name => (name.includes('/') || (getPack(name)?.when.length ?? 0) === 0) && !loaded.packs.includes(name)
  )
  const policy: Policy = { ...loaded, packs: [...new Set([...loaded.packs, ...named])] }

  if (named.length > 0) {
    const file = findConfigFile(root)

    if (file) {
      notes.push(
        `Add packs: ${JSON.stringify(policy.packs)} to ${file.slice(root.length + 1)}. Pawl does not edit a policy file you wrote.`
      )
    } else {
      actions.push({
        path: 'pawl.config.ts',
        kind: 'create',
        summary: `packs: ${named.join(', ')}`,
        apply: () => writeText(join(root, 'pawl.config.ts'), policyFile({ packs: policy.packs }))
      })
    }
  }

  const present = listed(root)
  const packages = [
    ...new Set([...(needsEslint ? ['eslint'] : []), ...names.flatMap(name => getPack(name)?.plugin ?? [])])
  ].filter(name => !present.has(name))
  const manifest = install ? undefined : planScripts(root, notes, packages)

  if (manifest) actions.push(manifest)

  return {
    detection,
    mode: 'auto',
    engines: ['eslint'],
    formatter: 'biome',
    actions,
    notes,
    install: install && packages.length > 0 ? installCommand(detection, packages) : undefined,
    packages,
    policy
  }
}
