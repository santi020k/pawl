/**
 * The guard on the ratchet, run from a coding agent's hook before each tool call. An agent that
 * cannot make a check pass can make it stop failing instead: record the findings with
 * `pawl baseline`, edit `.pawl/baseline.json`, or loosen the policy or an engine config. Each of
 * those is a person's decision, so the guard hands it to one: Claude Code and Copilot ask the
 * person, and Codex, which cannot ask, refuses a change to the baseline and says why.
 *
 * The guard only reads the payload. It loads no project and runs no engine, because it runs
 * before every edit and every shell command the agent makes.
 */

import { isAbsolute, posix, resolve } from 'node:path'
import { BASELINE_FILE } from '../check/baseline.ts'
import {
  BIOME_CONFIG_FILES,
  ESLINT_CONFIG_FILES,
  OXLINT_CONFIG_FILES,
  PAWL_CONFIG_FILES,
  PRETTIER_CONFIG_FILES
} from '../project/config-files.ts'
import { projectPath } from '../project/files.ts'
import { isRecord } from '../utils/json.ts'

/**
 * Which host is asking, which decides the answer: Claude Code and Copilot can ask the person;
 * Codex parses "ask" but does not support it yet, so it gets a refusal or nothing.
 */
export type GuardHost = 'claude' | 'codex' | 'copilot'

/** A tool call an agent is about to make. */
export interface GuardPayload {
  host: GuardHost
  /** The files the tool writes, moves or deletes, as the payload names them. */
  files: string[]
  /** The shell command, for a tool that runs one. */
  command?: string
  /** The folder the agent's relative paths start from, when the payload says. */
  cwd?: string
}

/** What the guard found in a tool call. */
export interface GuardFinding {
  /** The project files the tool would change that decide what the ratchet allows. */
  files: string[]
  /** The baseline itself, or `pawl baseline`, which rewrites it: what Codex refuses. */
  baseline: boolean
  /** The command runs `pawl baseline`. */
  records: boolean
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const PATH_FIELDS = ['file_path', 'filePath', 'path', 'notebook_path'] as const

/** Every file an `apply_patch` patch adds, updates, deletes or moves to. */
const PATCH_FILES = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

const stringsIn = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]

  if (Array.isArray(value)) return value.flatMap(stringsIn)

  return isRecord(value) ? Object.values(value).flatMap(stringsIn) : []
}

const pathsIn = (input: unknown): string[] => {
  if (!isRecord(input)) return []

  const edits = Array.isArray(input.replacements) ? input.replacements : []

  return [input, ...edits]
    .flatMap(item => (isRecord(item) ? PATH_FIELDS.map(field => item[field]) : []))
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
}

/**
 * Read the payload of a hook that runs before a tool: `PreToolUse` in Claude Code and Codex, and
 * Copilot's own `preToolUse`, which names no event, has `toolName` and `toolArgs`, and has no
 * `toolResult` yet. Copilot's payload after a tool looks the same when a host leaves the result
 * out, so it is only read as one before a tool from the guard's command, `check --hook`, never
 * from the edit hook's `fix --hook`. Undefined for any other payload.
 */
export const readGuardPayload = (
  text: string,
  { env = process.env, copilot = true }: { env?: Readonly<Record<string, string | undefined>>; copilot?: boolean } = {}
): GuardPayload | undefined => {
  const payload = parse(text)

  if (!isRecord(payload)) return undefined

  const claudeShape = payload.hook_event_name === 'PreToolUse'
  const copilotShape =
    copilot &&
    payload.hook_event_name === undefined &&
    typeof payload.toolName === 'string' &&
    !('toolResult' in payload) &&
    !('stopReason' in payload)

  if (!claudeShape && !copilotShape) return undefined

  // Codex sends Claude Code's shape, with the turn it is in, and runs its hooks with its own variables.
  const codex = claudeShape && ('turn_id' in payload || env.CODEX_THREAD_ID !== undefined)
  let host: GuardHost = codex ? 'codex' : 'claude'

  if (copilotShape) host = 'copilot'
  const tool = claudeShape ? payload.tool_name : payload.toolName
  const args = typeof payload.toolArgs === 'string' ? (parse(payload.toolArgs) ?? payload.toolArgs) : payload.toolArgs
  const input = claudeShape ? payload.tool_input : args
  const patch = tool === 'apply_patch'
  const files = patch
    ? stringsIn(input).flatMap(text => [...text.matchAll(PATCH_FILES)].map(match => (match[1] ?? '').trim()))
    : pathsIn(input)
  const command = !patch && isRecord(input) && typeof input.command === 'string' ? input.command : undefined
  const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? { cwd: payload.cwd } : {}

  return { host, files: [...new Set(files)], ...(command === undefined ? {} : { command }), ...cwd }
}

/** The files whose changes decide what the ratchet allows, by name, wherever they are in the project. */
const GUARDED = new Set([
  ...PAWL_CONFIG_FILES,
  ...BIOME_CONFIG_FILES,
  ...ESLINT_CONFIG_FILES,
  ...OXLINT_CONFIG_FILES,
  ...PRETTIER_CONFIG_FILES
])

const isBaseline = (path: string): boolean => path === BASELINE_FILE || path.endsWith(`/${BASELINE_FILE}`)

const guarded = (path: string): boolean => isBaseline(path) || GUARDED.has(posix.basename(path))

/** `pawl baseline`, however pawl is run: `npx --no pawl baseline`, `pnpm exec pawl baseline`, `node …/pawl/dist/cli.js baseline`. */
const RECORDS = /\bpawl\b[^\n;&|]*?\sbaseline\b/

/** A command that writes, moves or removes the baseline file, rather than one that reads it. */
const WRITERS = [
  '>',
  String.raw`\btee\b`,
  String.raw`\brm\b`,
  String.raw`\bmv\b`,
  String.raw`\bcp\b`,
  String.raw`\b(?:sed)\s+-i`
]
const MORE_WRITERS = [String.raw`\btruncate\b`, String.raw`\bunlink\b`, String.raw`\bgit\s+(?:checkout|restore|rm)\b`]
const BASELINE_PATTERN = BASELINE_FILE.replace(/[./]/g, match => `\\${match}`)
const WRITES_BASELINE = new RegExp(
  `(?:${[...WRITERS, ...MORE_WRITERS].join('|')})[^\\n;&|]*${BASELINE_PATTERN}|${BASELINE_PATTERN}[^\\n;&|]*(?:>|\\btee\\b)`
)

/** What a tool call would change that the guard hands to a person, or undefined for anything else. */
export const guardFinding = (root: string, payload: GuardPayload): GuardFinding | undefined => {
  const base = payload.cwd ?? root
  const files = payload.files.flatMap(file => {
    const path = projectPath(root, isAbsolute(file) ? file : resolve(base, file))

    return path !== undefined && guarded(path) ? [path] : []
  })
  const command = payload.command ?? ''
  const records = RECORDS.test(command)
  const writes = WRITES_BASELINE.test(command)
  const baseline = records || writes || files.some(isBaseline)

  if (files.length === 0 && !records && !writes) return undefined

  return {
    files: writes && !files.some(isBaseline) ? [...files, BASELINE_FILE] : [...new Set(files)],
    baseline,
    records
  }
}

const what = (finding: GuardFinding): string => {
  const parts = [
    ...(finding.records ? ['"pawl baseline", which records every current finding as allowed'] : []),
    ...finding.files.map(file => (isBaseline(file) ? `${file}, the findings the check allows` : file))
  ]

  return parts.join(' and ')
}

/**
 * The hook's answer, as the host reads it, or undefined to let the call through unchanged: Claude
 * Code and Copilot ask the person; Codex refuses a change to the baseline and lets the rest pass.
 */
export const guardReply = (payload: GuardPayload, finding: GuardFinding | undefined): string | undefined => {
  if (!finding) return undefined

  if (payload.host === 'codex') {
    if (!finding.baseline) return undefined

    const reason = `Pawl does not let a coding agent change what its check allows: this would change ${what(finding)}. Fix the findings instead. If the user wants to accept them, they run "pawl baseline" themselves.`

    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
    })
  }

  const reason = `This changes what pawl's check allows: ${what(finding)}. Allow it only if you asked for this change; otherwise the agent should fix the findings instead.`

  if (payload.host === 'copilot') return JSON.stringify({ permissionDecision: 'ask', permissionDecisionReason: reason })

  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason }
  })
}
