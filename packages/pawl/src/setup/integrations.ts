/** What pawl adds around the engines: scripts, task runners, editors, coding agents and Git hooks. */

import { chmodSync, existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstExisting, LEFTHOOK_CONFIG_FILES } from '../project/config-files.ts'
import { type Detection } from '../project/detect.ts'
import { type FormatterName } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { isRecord, type JsonRecord, readJson, readJsonc, writeJson } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { rangeFor } from './install.ts'
import { planJsonMerge, type SetupAction } from './plan.ts'
import {
  AGENT_HOOK_COMMAND,
  AGENTS_BLOCK,
  AGENTS_END,
  AGENTS_START,
  EDITOR_SETTINGS,
  HOOK_COMMAND,
  OLD_AGENT_HOOK_COMMANDS,
  PRETTIER_EDITOR_SETTINGS,
  SKILL_FILE,
  SKILL_MARKER,
  workflowFile
} from './templates.ts'

/** Add the check and fix scripts, and, when pawl is not running the install, the packages to install. */
export const planScripts = (root: string, notes: string[], packages: readonly string[]): SetupAction | undefined => {
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

  for (const name of packages) devDependencies[name] = rangeFor(name, root)

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
export const planTurboTasks = (root: string, notes: string[]): SetupAction | undefined => {
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

/** One agent's hook file: where it goes, and how to add pawl's hook to what the file already holds. */
interface AgentHook {
  file: string
  agent: string
  summary: string
  add: (existing: JsonRecord) => JsonRecord
}

/** The hooks a key holds, as a list, whatever the file had there. */
const hookList = (hooks: unknown, key: string): unknown[] =>
  isRecord(hooks) && Array.isArray(hooks[key]) ? hooks[key] : []

/**
 * Add pawl's hook to an agent's hook file, next to the hooks already there. A hook an earlier
 * version of pawl wrote is swapped for the current one in place, so a re-run never adds a second.
 */
const planAgentHook = (root: string, notes: string[], hook: AgentHook): SetupAction | undefined => {
  const path = join(root, hook.file)
  const existing = existsSync(path) ? readJsonc<JsonRecord>(path) : { value: {} as JsonRecord, hasComments: false }

  if (!existing.value || existing.hasComments) {
    notes.push(`${hook.file} could not be read, so pawl added no ${hook.agent} hook.`)

    return undefined
  }

  // Whole JSON strings, so a command that only starts like pawl's is not taken for it.
  const text = JSON.stringify(existing.value)
  const current = JSON.stringify(AGENT_HOOK_COMMAND)

  if (text.includes(current)) return undefined

  const old = OLD_AGENT_HOOK_COMMANDS.map(command => JSON.stringify(command)).find(command => text.includes(command))
  const next = old ? (JSON.parse(text.replaceAll(old, current)) as JsonRecord) : hook.add(existing.value)

  return {
    path: hook.file,
    kind: existsSync(path) ? 'update' : 'create',
    summary: hook.summary,
    apply: () => writeJson(path, next)
  }
}

/** A PostToolUse entry in the shape Claude Code and Codex share. */
const postToolUse = (existing: JsonRecord, matcher: string): JsonRecord => {
  const hooks = isRecord(existing.hooks) ? existing.hooks : {}
  const entry = { matcher, hooks: [{ type: 'command', command: AGENT_HOOK_COMMAND }] }

  return { ...existing, hooks: { ...hooks, PostToolUse: [...hookList(hooks, 'PostToolUse'), entry] } }
}

/** Claude Code: fix each edit, and give Claude what is left next to the tool result. */
const CLAUDE_HOOK: AgentHook = {
  file: '.claude/settings.json',
  agent: 'Claude Code',
  summary: 'hook that fixes each Claude Code edit and tells Claude what is left',
  add: existing => postToolUse(existing, 'Edit|Write|MultiEdit')
}

/**
 * Cursor: fix each edit. Cursor reads nothing back from an `afterFileEdit` hook, so the AGENTS.md
 * instructions tell the agent to run the check.
 */
const CURSOR_HOOK: AgentHook = {
  file: '.cursor/hooks.json',
  agent: 'Cursor',
  summary: 'hook that fixes and formats after each Cursor edit',
  add: existing => {
    const hooks = isRecord(existing.hooks) ? existing.hooks : {}

    return {
      version: 1,
      ...existing,
      hooks: { ...hooks, afterFileEdit: [...hookList(hooks, 'afterFileEdit'), { command: AGENT_HOOK_COMMAND }] }
    }
  }
}

/**
 * Codex: every file edit is an `apply_patch`, and a PostToolUse hook's `additionalContext` reaches
 * the model. Codex runs a project's hooks only once they are trusted, in its /hooks screen.
 */
const CODEX_HOOK: AgentHook = {
  file: '.codex/hooks.json',
  agent: 'Codex',
  summary: 'hook that fixes each Codex edit and tells Codex what is left',
  add: existing => postToolUse(existing, 'apply_patch')
}

/**
 * The Copilot CLI and cloud agent read hooks from .github/hooks. A Copilot hook runs after every
 * tool, so `--hook` itself skips the tools that edit nothing.
 */
const COPILOT_HOOK: AgentHook = {
  file: '.github/hooks/pawl.json',
  agent: 'Copilot',
  summary: 'hook that fixes each Copilot edit and tells Copilot what is left',
  add: existing => {
    const hooks = isRecord(existing.hooks) ? existing.hooks : {}
    const entry = { type: 'command', command: AGENT_HOOK_COMMAND, timeoutSec: 60 }

    return { version: 1, ...existing, hooks: { ...hooks, postToolUse: [...hookList(hooks, 'postToolUse'), entry] } }
  }
}

/** The files that say a repo uses Copilot's agents. */
const COPILOT_FILES = ['.github/copilot-instructions.md', '.github/instructions', '.github/hooks']

/**
 * The hooks for each agent the repo uses. Claude Code always gets one; Cursor, Codex and Copilot
 * only where their folders or files are already there, so no one gets an empty folder for a tool
 * they do not use.
 */
const planAgentHooks = (root: string, notes: string[]): (SetupAction | undefined)[] => {
  const codex = existsSync(join(root, '.codex')) ? planAgentHook(root, notes, CODEX_HOOK) : undefined

  if (codex) notes.push("Codex runs a project's hooks once they are trusted. Review pawl's hook in Codex's /hooks.")

  return [
    planAgentHook(root, notes, CLAUDE_HOOK),
    existsSync(join(root, '.cursor')) ? planAgentHook(root, notes, CURSOR_HOOK) : undefined,
    codex,
    COPILOT_FILES.some(file => existsSync(join(root, file))) ? planAgentHook(root, notes, COPILOT_HOOK) : undefined
  ]
}

/** An import of AGENTS.md in a Claude Code memory file, from wherever that file is. */
const IMPORTS_AGENTS = /@(?:\.{1,2}\/)*AGENTS\.md\b/

/**
 * Claude Code reads CLAUDE.md, not AGENTS.md, so the instructions reach it through an import. An
 * existing CLAUDE.md gets the import at its end; without one, pawl writes a CLAUDE.md that only
 * imports AGENTS.md. A CLAUDE.md that is a link, as Claude Code's docs suggest for AGENTS.md, is
 * left alone.
 */
const planClaudeImport = (root: string): SetupAction | undefined => {
  const summary = 'import AGENTS.md, which Claude Code does not read on its own'

  for (const [file, line] of [
    ['CLAUDE.md', '@AGENTS.md'],
    ['.claude/CLAUDE.md', '@../AGENTS.md']
  ] as const) {
    const path = join(root, file)

    if (!existsSync(path)) continue

    if (lstatSync(path).isSymbolicLink()) return undefined

    const current = readFileSync(path, 'utf8')

    if (IMPORTS_AGENTS.test(current) || current.includes(AGENTS_START)) return undefined

    return { path: file, kind: 'update', summary, apply: () => writeText(path, `${current.trimEnd()}\n\n${line}\n`) }
  }

  return { path: 'CLAUDE.md', kind: 'create', summary, apply: () => writeText(join(root, 'CLAUDE.md'), '@AGENTS.md\n') }
}

/**
 * Gemini CLI reads GEMINI.md unless its settings name other context files. In a repo that has a
 * .gemini folder, pawl adds AGENTS.md to that list and keeps what the list already read.
 */
const planGeminiContext = (root: string, notes: string[]): SetupAction | undefined => {
  if (!existsSync(join(root, '.gemini'))) return undefined

  const settings = readJsonc<JsonRecord>(join(root, '.gemini/settings.json')).value
  const context = isRecord(settings?.context) ? settings.context : {}
  const fileName = context.fileName
  const read =
    typeof fileName === 'string' || Array.isArray(fileName)
      ? toList(fileName).filter((name): name is string => typeof name === 'string')
      : ['GEMINI.md']

  if (read.includes('AGENTS.md')) return undefined

  return planJsonMerge(
    root,
    '.gemini/settings.json',
    { context: { fileName: [...read, 'AGENTS.md'] } },
    'have Gemini CLI read AGENTS.md as well',
    notes
  )
}

/** Where agents look for a project's skills: Claude Code's folder, and the one Codex and Copilot share. */
const SKILL_FILES = ['.claude/skills/pawl/SKILL.md', '.agents/skills/pawl/SKILL.md']

/**
 * The pawl skill: what to run after an edit, how to read the findings, and what not to do. Init
 * keeps its own copy up to date. A copy without pawl's marker line is someone's own, left alone.
 */
const planSkills = (root: string, notes: string[]): SetupAction[] =>
  SKILL_FILES.flatMap((file): SetupAction[] => {
    const path = join(root, file)
    const write = (kind: SetupAction['kind']): SetupAction[] => [
      {
        path: file,
        kind,
        summary: 'skill that tells coding agents how to check and fix their work with pawl',
        apply: () => writeText(path, SKILL_FILE)
      }
    ]

    if (!existsSync(path)) return write('create')

    const current = readFileSync(path, 'utf8')

    if (current === SKILL_FILE) return []

    if (!current.includes(SKILL_MARKER)) {
      notes.push(`${file} is not the one pawl writes, so pawl left it alone.`)

      return []
    }

    return write('update')
  })

/** Instructions any coding agent can follow, kept in a marked block so they can be updated later. */
const planAgentsFile = (root: string): SetupAction | undefined => {
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

/** A pre-commit hook, through the hook manager the repo already uses. */
export const planHook = (root: string, detection: Detection, notes: string[]): SetupAction | undefined => {
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

/** VS Code settings that format on save with the project's formatter, and a recommendation for its extension. */
export const planEditor = (root: string, formatter: FormatterName, notes: string[]): SetupAction[] => {
  const settings = formatter === 'biome' ? EDITOR_SETTINGS : PRETTIER_EDITOR_SETTINGS
  const extension = formatter === 'biome' ? 'biomejs.biome' : 'esbenp.prettier-vscode'
  const name = formatter === 'biome' ? 'Biome' : 'Prettier'
  const actions = [planJsonMerge(root, '.vscode/settings.json', settings, `format on save with ${name}`, notes)]
  const current =
    readJsonc<{ recommendations?: string[] }>(join(root, '.vscode/extensions.json')).value?.recommendations ?? []

  if (!current.includes(extension)) {
    actions.push(
      planJsonMerge(
        root,
        '.vscode/extensions.json',
        { recommendations: [...current, extension] },
        `recommend the ${name} extension`,
        notes
      )
    )
  }

  return actions.filter((action): action is SetupAction => action !== undefined)
}

/** The GitHub workflow that runs the check on every pull request. An existing one is left alone. */
export const planWorkflow = (root: string, detection: Detection): SetupAction | undefined => {
  if (existsSync(join(root, '.github/workflows/pawl.yml'))) return undefined

  return {
    path: '.github/workflows/pawl.yml',
    kind: 'create',
    summary: 'run "pawl check --ci" on every pull request and keep the doctor report',
    apply: () => writeText(join(root, '.github/workflows/pawl.yml'), workflowFile(detection.packageManager ?? 'npm'))
  }
}

/**
 * Everything `--agents` sets up: hooks that fix each edit and hand back what is left, the
 * AGENTS.md instructions and what makes Claude Code and Gemini CLI read them, and the pawl skill.
 */
export const planAgents = (root: string, notes: string[]): SetupAction[] =>
  [
    ...planAgentHooks(root, notes),
    planAgentsFile(root),
    planClaudeImport(root),
    planGeminiContext(root, notes),
    ...planSkills(root, notes)
  ].filter((action): action is SetupAction => action !== undefined)
