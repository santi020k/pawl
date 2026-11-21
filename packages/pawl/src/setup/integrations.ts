/** What pawl adds around the engines: scripts, task runners, editors, coding agents and Git hooks. */

import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstExisting, LEFTHOOK_CONFIG_FILES } from '../project/config-files.ts'
import { type Detection } from '../project/detect.ts'
import { type FormatterName } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { isRecord, type JsonRecord, readJson, readJsonc, writeJson } from '../utils/json.ts'
import { rangeFor } from './install.ts'
import { planJsonMerge, type SetupAction } from './plan.ts'
import {
  AGENTS_BLOCK,
  AGENTS_END,
  AGENTS_START,
  EDITOR_SETTINGS,
  HOOK_COMMAND,
  PRETTIER_EDITOR_SETTINGS,
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

const planAgentHook = (root: string, notes: string[]): SetupAction | undefined => {
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
const planCursorHook = (root: string, notes: string[]): SetupAction | undefined => {
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

/** Hooks that show coding agents their findings after each edit, and instructions any agent can follow. */
export const planAgents = (root: string, notes: string[]): SetupAction[] =>
  [planAgentHook(root, notes), planCursorHook(root, notes), planAgentsFile(root)].filter(
    (action): action is SetupAction => action !== undefined
  )
