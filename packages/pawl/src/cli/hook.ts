/**
 * `pawl fix --hook` and `pawl check --hook`, run from a coding agent's post-edit hook. The agent's
 * payload on stdin names the files it edited. Pawl looks at those files only, and answers in the
 * shape that agent reads back, so what is left reaches the model and not just the person watching.
 */

import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { type Readable } from 'node:stream'
import { formatAgent } from '../check/output.ts'
import { BLOCKING, type CheckResult } from '../check/result.ts'
import { projectPath } from '../project/files.ts'
import { isDirectory } from '../utils/fs.ts'
import { isRecord } from '../utils/json.ts'
import { plural } from '../utils/text.ts'

/**
 * How an agent hears what is left after its edit:
 * - `context`: a PostToolUse hook's `hookSpecificOutput.additionalContext`, which Claude Code adds
 *   next to the tool result and Codex adds as developer context.
 * - `copilot`: a top-level `additionalContext`, which the Copilot CLI and cloud agent append to
 *   the tool result. Copilot shows a hook's stderr to the user only, so stdout is the way in.
 * - `none`: the host cannot pass anything to the agent, as with Cursor's `afterFileEdit`.
 *   Pawl still fixes, and the AGENTS.md instructions tell the agent to run the check.
 */
export type HookReply = 'context' | 'copilot' | 'none'

export interface HookPayload {
  /** The files the agent edited, absolute or relative to `cwd`. */
  files: string[]
  /** The folder the agent's relative paths start from, when the payload says. */
  cwd?: string
  reply: HookReply
}

/**
 * File tools of the hosts that name their tools in lower case and run a hook after every tool,
 * with no matcher to pick the edits: the Copilot CLI and cloud agent, VS Code, Codex and Devin.
 * Claude Code's tools are capitalised (`Write`, `Edit`), and its matcher only lets edits through.
 */
const EDIT_TOOLS = new Set([
  'apply_patch',
  'create',
  'create_file',
  'edit',
  'editFiles',
  'edit_notebook_file',
  'insert_edit_into_file',
  'multi_replace_string_in_file',
  'replace_string_in_file',
  'str_replace',
  'str_replace_editor',
  'write',
  'copilot_applyPatch',
  'copilot_createFile',
  'copilot_insertEdit',
  'copilot_multiReplaceString',
  'copilot_replaceString'
])

/** The fields hosts put an edited file in: `file_path` (Claude Code, Cursor), `filePath` (VS Code), `path` (Copilot). */
const PATH_FIELDS = ['file_path', 'filePath', 'path'] as const

/** The headers of an `apply_patch` patch that name a file which exists after it: added, updated or moved to. */
const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const pathsIn = (input: unknown): string[] => {
  if (!isRecord(input)) return []

  const direct = PATH_FIELDS.map(field => input[field])
  // VS Code's multi_replace_string_in_file edits several files in one call.
  const replaced = Array.isArray(input.replacements)
    ? input.replacements.flatMap(item => (isRecord(item) ? PATH_FIELDS.map(field => item[field]) : []))
    : []

  return [...direct, ...replaced].filter((path): path is string => typeof path === 'string')
}

/** Every string anywhere in a JSON value, for the patch text, wherever a host puts it. */
const stringsIn = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]

  if (Array.isArray(value)) return value.flatMap(stringsIn)

  return isRecord(value) ? Object.values(value).flatMap(stringsIn) : []
}

const patchPaths = (input: unknown): string[] =>
  stringsIn(input).flatMap(text => [...text.matchAll(PATCH_FILE)].map(match => (match[1] ?? '').trim()))

const replyFor = (payload: Record<string, unknown>): HookReply => {
  // Copilot's own payload, and the one it sends in VS Code's shape, which also says PostToolUse.
  if ('toolName' in payload || 'tool_result' in payload) return 'copilot'

  return payload.hook_event_name === 'PostToolUse' ? 'context' : 'none'
}

/**
 * Read a hook payload: Claude Code's and Codex's `tool_input`, Cursor's top-level `file_path`,
 * Copilot's `toolArgs` (an object, or JSON in a string) and Windsurf's `tool_info`. Codex edits
 * through `apply_patch`, so its files are read from the patch. A payload that cannot be read,
 * or a tool that edits nothing, names no files: guessing would touch files the agent never did.
 */
export const readPayload = (text: string): HookPayload => {
  const payload = parse(text)

  if (!isRecord(payload)) return { files: [], reply: 'none' }

  const reply = replyFor(payload)
  const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? { cwd: payload.cwd } : {}
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : payload.toolName

  if (typeof tool === 'string' && /^[a-z]/.test(tool) && !EDIT_TOOLS.has(tool)) return { files: [], reply, ...cwd }

  const args = typeof payload.toolArgs === 'string' ? (parse(payload.toolArgs) ?? payload.toolArgs) : payload.toolArgs
  const input = payload.tool_input ?? args ?? payload.tool_info ?? payload
  const named = tool === 'apply_patch' ? patchPaths(input) : pathsIn(input)
  const files = [...new Set(named.filter(file => file.length > 0))]

  return { files, reply, ...cwd }
}

/**
 * The edited files that still exist inside the project, as project paths. A folder is not an
 * edited file, and must not widen the run to everything in it.
 */
export const hookFiles = (root: string, payload: HookPayload): string[] => {
  const base = payload.cwd ?? root
  const inside = payload.files.flatMap(file => {
    const absolute = isAbsolute(file) ? file : resolve(base, file)
    const path = existsSync(absolute) && !isDirectory(absolute) ? projectPath(root, absolute) : undefined

    return path === undefined ? [] : [path]
  })

  return [...new Set(inside)]
}

/** A host leaves its payload on stdin as it starts the hook. This only bounds one that never writes. */
const STDIN_DEADLINE_MS = 1000

/**
 * The hook payload on stdin. Resolves when stdin ends, as soon as the text is a whole JSON
 * document (some hosts keep stdin open), or at the deadline. A terminal has no payload.
 */
export const readStdin = async (
  stdin: Readable & { isTTY?: boolean } = process.stdin,
  deadline = STDIN_DEADLINE_MS
): Promise<string> => {
  if (stdin.isTTY) return ''

  let text = ''
  const settled = new AbortController()
  const timer = setTimeout(() => settled.abort(), deadline)
  const onData = (chunk: Buffer | string): void => {
    text += chunk.toString()

    if (parse(text) !== undefined) settled.abort()
  }

  stdin.on('data', onData)

  try {
    await once(stdin, 'end', { signal: settled.signal })
  } catch {
    // The payload is whole, the deadline passed, or stdin failed: what arrived is all there is.
  } finally {
    clearTimeout(timer)
    stdin.off('data', onData)
    // A paused stdin does not keep the process alive when the host leaves the pipe open.
    stdin.pause()
  }

  return text
}

/** Claude Code and Copilot cap what a hook adds to the context at 10,000 characters. */
const CONTEXT_LIMIT = 9000

/** The most the "and more" line takes. */
const MORE_LINE = 100

/** What the agent reads: what pawl did, then one JSON line per problem, as `--format agent` prints them. */
export const hookMessage = (result: CheckResult, fixed: boolean): string | undefined => {
  // After a fix, what is still marked fixable needs an unsafe fix: "run pawl fix" would go round in circles.
  const findings = fixed ? result.findings.map(finding => ({ ...finding, fixable: false })) : result.findings
  const lines = formatAgent({ ...result, setup: [], findings })
    .split('\n')
    .filter(Boolean)

  if (lines.length === 0) return undefined

  const count = plural(result.findings.length, 'problem')
  const head = [
    fixed
      ? `pawl applied the safe fixes and formatting to the files you just edited. ${count} left:`
      : `pawl found ${count} in the files you just edited:`
  ]
  const tail = [
    'Fix them in the code. Do not add a disable comment (biome-ignore, eslint-disable, @ts-ignore), weaken a test or skip one: those fail the check too.'
  ]
  const kept: string[] = []
  // Room for the line that says how many more there are, which goes in when not every line fits.
  let length = [...head, ...tail].join('\n').length + MORE_LINE

  for (const line of lines) {
    if (length + line.length + 1 > CONTEXT_LIMIT) break

    kept.push(line)
    length += line.length + 1
  }

  if (kept.length < lines.length) {
    tail.unshift(
      `And ${plural(lines.length - kept.length, 'more line')}: run "npx pawl check --changed --format agent" to see them all.`
    )
  }

  return [...head, ...kept, ...tail].join('\n')
}

/** The JSON a host reads from the hook's stdout. Undefined for a host that reads nothing back. */
export const hookReply = (message: string, reply: HookReply): string | undefined => {
  if (reply === 'none') return undefined

  return JSON.stringify(
    reply === 'copilot'
      ? { additionalContext: message }
      : { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }
  )
}

/**
 * When part of the check could not run, the person should hear it, not the agent: an agent told
 * that Biome is missing would go and install it. One line per problem, for the hook's stderr.
 */
export const hookSetupProblems = (result: CheckResult): string | undefined => {
  const blocking = result.setup.filter(issue => BLOCKING.includes(issue.code))

  if (blocking.length === 0) return undefined

  return blocking.map(issue => `pawl: ${issue.message}${issue.fix ? ` ${issue.fix}` : ''}`).join('\n')
}
