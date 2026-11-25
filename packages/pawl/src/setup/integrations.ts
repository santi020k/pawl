/** What pawl adds around the engines: scripts, task runners, editors, coding agents and Git hooks. */

import { chmodSync, existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstExisting, LEFTHOOK_CONFIG_FILES } from '../project/config-files.ts'
import { type Detection } from '../project/detect.ts'
import { type FormatterName } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { isRecord, type JsonRecord, readJson, readJsonc, writeJson } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { PACKAGE_NAME } from '../version.ts'
import { rangeFor } from './install.ts'
import { planJsonMerge, type SetupAction } from './plan.ts'
import {
  AGENT_HOOK_COMMAND,
  AGENTS_BLOCK,
  AGENTS_END,
  AGENTS_START,
  EDITOR_SETTINGS,
  GUARD_HOOK_COMMAND,
  HOOK_COMMAND,
  legacyCommand,
  OLD_AGENT_HOOK_COMMANDS,
  PRETTIER_EDITOR_SETTINGS,
  SKILL_FILE,
  SKILL_MARKER,
  STOP_HOOK_COMMAND,
  VSCODE_TASKS,
  workflowFile,
  ZED_TASKS
} from './templates.ts'

/** Add the check and fix scripts, and, when pawl is not running the install, the packages to install. */
export const planScripts = (root: string, notes: string[], packages: readonly string[]): SetupAction | undefined => {
  const path = join(root, 'package.json')
  const manifest = readJson<JsonRecord>(path)

  if (!manifest) {
    notes.push(`No package.json here, so pawl added no scripts. Run "npx ${PACKAGE_NAME} check" directly.`)

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
  /** The event the stop hook goes under. */
  stopEvent: string
  /** Add the hook that runs when the agent stops, which sends it back while errors are left. */
  addStop: (existing: JsonRecord) => JsonRecord
  /** The event the guard goes under, for an agent with a hook before each tool that can ask or refuse. */
  guardEvent?: string
  /** Add the guard, which hands a change to the baseline, the policy or an engine config to a person. */
  addGuard?: (existing: JsonRecord) => JsonRecord
}

/** Whether an event of a hook file already runs a command, as a whole JSON string. */
const eventRuns = (value: JsonRecord, event: string, command: string): boolean =>
  JSON.stringify(isRecord(value.hooks) ? (value.hooks[event] ?? []) : []).includes(JSON.stringify(command))

/** The hooks a key holds, as a list, whatever the file had there. */
const hookList = (hooks: unknown, key: string): unknown[] =>
  isRecord(hooks) && Array.isArray(hooks[key]) ? hooks[key] : []

/**
 * Add pawl's hooks to an agent's hook file, next to the hooks already there: the one after each
 * edit and the one when the agent stops. A hook an earlier version of pawl wrote is swapped for
 * the current one in place, so a re-run never adds a second.
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
  const old = OLD_AGENT_HOOK_COMMANDS.map(command => JSON.stringify(command)).find(command => text.includes(command))
  let edits = existing.value

  if (!text.includes(current)) edits = old ? (JSON.parse(text.replaceAll(old, current)) as JsonRecord) : hook.add(edits)

  const stopped = eventRuns(edits, hook.stopEvent, STOP_HOOK_COMMAND) ? edits : hook.addStop(edits)
  const next =
    hook.guardEvent && hook.addGuard && !eventRuns(stopped, hook.guardEvent, GUARD_HOOK_COMMAND)
      ? hook.addGuard(stopped)
      : stopped

  if (next === existing.value) return undefined

  return {
    path: hook.file,
    kind: existsSync(path) ? 'update' : 'create',
    summary: hook.summary,
    apply: () => writeJson(path, next)
  }
}

/** A Stop entry in the shape Claude Code and Codex share. Neither applies a matcher to Stop. */
const stopEntry = (existing: JsonRecord): JsonRecord => {
  const hooks = isRecord(existing.hooks) ? existing.hooks : {}
  const entry = { hooks: [{ type: 'command', command: STOP_HOOK_COMMAND }] }

  return { ...existing, hooks: { ...hooks, Stop: [...hookList(hooks, 'Stop'), entry] } }
}

/** A PreToolUse entry in the shape Claude Code and Codex share: the guard, before the tools that can change files. */
const preToolUse = (existing: JsonRecord, matcher: string): JsonRecord => {
  const hooks = isRecord(existing.hooks) ? existing.hooks : {}
  const entry = { matcher, hooks: [{ type: 'command', command: GUARD_HOOK_COMMAND }] }

  return { ...existing, hooks: { ...hooks, PreToolUse: [...hookList(hooks, 'PreToolUse'), entry] } }
}

/** A PostToolUse entry in the shape Claude Code and Codex share. */
const postToolUse = (existing: JsonRecord, matcher: string): JsonRecord => {
  const hooks = isRecord(existing.hooks) ? existing.hooks : {}
  const entry = { matcher, hooks: [{ type: 'command', command: AGENT_HOOK_COMMAND }] }

  return { ...existing, hooks: { ...hooks, PostToolUse: [...hookList(hooks, 'PostToolUse'), entry] } }
}

/** Claude Code: fix each edit, give Claude what is left next to the tool result, and check again as it stops. */
const CLAUDE_HOOK: AgentHook = {
  file: '.claude/settings.json',
  agent: 'Claude Code',
  summary:
    'hooks that fix each Claude Code edit, tell Claude what is left, and send it back when it stops with errors left',
  add: existing => postToolUse(existing, 'Edit|Write|MultiEdit'),
  stopEvent: 'Stop',
  addStop: stopEntry,
  guardEvent: 'PreToolUse',
  // PowerShell is the shell tool on Windows, and there the only one where Git Bash is not installed.
  addGuard: existing => preToolUse(existing, 'Edit|Write|MultiEdit|Bash|PowerShell')
}

/** An entry under one of Cursor's events, which take a list of commands and no matcher. */
const cursorEntry = (existing: JsonRecord, event: string, command: string): JsonRecord => {
  const hooks = isRecord(existing.hooks) ? existing.hooks : {}

  return { version: 1, ...existing, hooks: { ...hooks, [event]: [...hookList(hooks, event), { command }] } }
}

/**
 * Cursor: fix each edit. Cursor reads nothing back from an `afterFileEdit` hook, so what is left
 * reaches the agent from its `stop` hook, whose `followup_message` Cursor sends as the next prompt.
 */
const CURSOR_HOOK: AgentHook = {
  file: '.cursor/hooks.json',
  agent: 'Cursor',
  summary: 'hooks that fix each Cursor edit, and send the agent back when it stops with errors left',
  add: existing => cursorEntry(existing, 'afterFileEdit', AGENT_HOOK_COMMAND),
  stopEvent: 'stop',
  addStop: existing => cursorEntry(existing, 'stop', STOP_HOOK_COMMAND)
}

/**
 * Codex: every file edit is an `apply_patch`, and a PostToolUse hook's `additionalContext` reaches
 * the model. Codex runs a project's hooks only once they are trusted, in its /hooks screen.
 */
const CODEX_HOOK: AgentHook = {
  file: '.codex/hooks.json',
  agent: 'Codex',
  summary: 'hooks that fix each Codex edit, tell Codex what is left, and send it back when it stops with errors left',
  add: existing => postToolUse(existing, 'apply_patch'),
  stopEvent: 'Stop',
  addStop: stopEntry,
  guardEvent: 'PreToolUse',
  addGuard: existing => preToolUse(existing, 'apply_patch|Bash')
}

/**
 * The Copilot CLI and cloud agent read hooks from .github/hooks. A Copilot hook runs after every
 * tool, so `--hook` itself skips the tools that edit nothing.
 */
const copilotEntry = (existing: JsonRecord, event: string, command: string): JsonRecord => {
  const hooks = isRecord(existing.hooks) ? existing.hooks : {}
  const entry = { type: 'command', command, timeoutSec: 60 }

  return { version: 1, ...existing, hooks: { ...hooks, [event]: [...hookList(hooks, event), entry] } }
}

const COPILOT_HOOK: AgentHook = {
  file: '.github/hooks/pawl.json',
  agent: 'Copilot',
  summary:
    'hooks that fix each Copilot edit, tell Copilot what is left, and send it back when it stops with errors left',
  add: existing => copilotEntry(existing, 'postToolUse', AGENT_HOOK_COMMAND),
  stopEvent: 'agentStop',
  addStop: existing => copilotEntry(existing, 'agentStop', STOP_HOOK_COMMAND)
  // No guard: Copilot denies the tool when a preToolUse hook fails, so in a clone before the
  // install, where npx cannot find pawl, the guard would stop every tool the agent runs.
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

  if (codex) notes.push("Codex runs a project's hooks once they are trusted. Review pawl's hooks in Codex's /hooks.")

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

/** A hook file with the line an earlier version of pawl wrote swapped for the current command. */
const swapLegacyLine = (text: string, command: string): string => {
  const legacy = legacyCommand(command)

  return text
    .split('\n')
    .map(line => (line.trim() === legacy ? line.replace(legacy, command) : line))
    .join('\n')
}

/** A pre-commit hook, through the hook manager the repo already uses. */
export const planHook = (root: string, detection: Detection, notes: string[]): SetupAction | undefined => {
  const husky = join(root, '.husky')

  if (existsSync(husky)) {
    const path = join(husky, 'pre-commit')
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const swapped = swapLegacyLine(current, HOOK_COMMAND)

    if (swapped !== current) {
      return {
        path: '.husky/pre-commit',
        kind: 'update',
        summary: 'run the pre-commit check with the installed pawl only',
        apply: () => writeText(path, swapped)
      }
    }

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
  const hookFile = `#!/bin/sh\n${HOOK_COMMAND}\n`

  if (existsSync(path) && readFileSync(path, 'utf8') === `#!/bin/sh\n${legacyCommand(HOOK_COMMAND)}\n`) {
    return {
      path: '.git/hooks/pre-commit',
      kind: 'update',
      summary: 'run the pre-commit check with the installed pawl only',
      apply: () => writeText(path, hookFile)
    }
  }

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
      writeText(path, hookFile)
      chmodSync(path, 0o755)
    }
  }
}

/** The list of tasks in a tasks file. VS Code keeps it under "tasks", which may not be there yet; Zed's file is the list. */
const tasksIn = (value: unknown, shape: 'vscode' | 'zed'): unknown => {
  if (shape === 'zed') return value

  return isRecord(value) ? (value.tasks ?? []) : undefined
}

/** The label of a task in a tasks file, whatever else the entry holds. */
const labelOf = (task: unknown): unknown => (isRecord(task) ? task.label : undefined)

/**
 * Add pawl's tasks to an editor's tasks file: a new file, or the tasks it does not have yet, by
 * label. A task of the same name that the user wrote is theirs, and a file with comments is left
 * alone, with a note, since writing it back would drop them.
 */
const planTasks = (
  root: string,
  file: string,
  tasks: readonly JsonRecord[],
  shape: 'vscode' | 'zed',
  summary: string,
  notes: string[]
): SetupAction | undefined => {
  const path = join(root, file)
  const wrap = (list: readonly unknown[]): unknown => (shape === 'vscode' ? { version: '2.0.0', tasks: list } : list)

  if (!existsSync(path)) return { path: file, kind: 'create', summary, apply: () => writeJson(path, wrap(tasks)) }

  const { value, hasComments } = readJsonc<unknown>(path)
  const list = tasksIn(value, shape)

  if (!Array.isArray(list) || hasComments) {
    notes.push(
      `${file} has comments or could not be read, so pawl did not add its tasks. Add a "pawl: check" task by hand.`
    )

    return undefined
  }

  // A task of pawl's that still runs the command an earlier version wrote gets the current one.
  const ours = new Map<unknown, JsonRecord>(tasks.map(task => [task.label, task]))
  let swapped = 0
  const current = list.map(task => {
    const mine = ours.get(labelOf(task))

    if (!isRecord(task) || typeof mine?.command !== 'string' || task.command === mine.command) return task

    if (task.command !== legacyCommand(mine.command)) return task

    swapped += 1

    return { ...task, command: mine.command }
  })
  const labels = new Set(list.map(labelOf))
  const missing = tasks.filter(task => !labels.has(task.label))

  if (missing.length === 0 && swapped === 0) return undefined

  const next =
    shape === 'vscode' ? { ...(value as JsonRecord), tasks: [...current, ...missing] } : [...current, ...missing]

  return { path: file, kind: 'update', summary, apply: () => writeJson(path, next) }
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

  actions.push(
    planTasks(
      root,
      '.vscode/tasks.json',
      VSCODE_TASKS,
      'vscode',
      'tasks that put findings in the Problems panel',
      notes
    )
  )

  // Zed's tasks only where the repo already has Zed's folder, as for the agents' folders.
  if (existsSync(join(root, '.zed'))) {
    actions.push(planTasks(root, '.zed/tasks.json', ZED_TASKS, 'zed', 'tasks that check and fix from Zed', notes))
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
