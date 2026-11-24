/**
 * `pawl fix --hook` and `pawl check --hook`, run from a coding agent's hooks. After an edit, the
 * agent's payload on stdin names the files it edited: pawl looks at those files only, and answers
 * in the shape that agent reads back, so what is left reaches the model and not just the person
 * watching. When the agent stops, pawl checks every file it edited in the session, and sends it
 * back to work while new errors are left.
 */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { type Readable } from 'node:stream'
import { formatAgent } from '../check/output.ts'
import { BLOCKING, type CheckResult, tooManyWarnings } from '../check/result.ts'
import { projectPath } from '../project/files.ts'
import { PAWL } from '../setup/templates.ts'
import { isDirectory } from '../utils/fs.ts'
import { isRecord } from '../utils/json.ts'
import { plural } from '../utils/text.ts'
import { type StopState } from './hook-state.ts'

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

/**
 * How an agent hears that it is not done when it stops:
 * - `decision`: `{ "decision": "block", "reason": ... }`, which Claude Code, Codex and Copilot
 *   read as "keep going", with the reason as the agent's next instruction.
 * - `followup`: Cursor's `followup_message`, which Cursor sends as the next user message.
 */
export type StopReply = 'decision' | 'followup'

export interface HookPayload {
  /** The files the agent edited, absolute or relative to `cwd`. */
  files: string[]
  /** The folder the agent's relative paths start from, when the payload says. */
  cwd?: string
  reply: HookReply
  /** The agent's session, when the payload names it: Cursor calls it a conversation. */
  session?: string
}

/** The payload of a hook that runs when the agent stops. */
export interface StopPayload {
  reply: StopReply
  session?: string
  /** True when a stop hook already sent the agent back, and this is the stop after it. */
  continuing: boolean
  /** False when the person cancelled the turn or it failed: then pawl does not send it back. */
  finished: boolean
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

/** The session a payload names: `session_id` (Claude Code, Codex, VS Code), `sessionId` (Copilot), `conversation_id` (Cursor). */
const sessionOf = (payload: Record<string, unknown>): { session?: string } => {
  const value = [payload.session_id, payload.sessionId, payload.conversation_id].find(
    (item): item is string => typeof item === 'string' && item.length > 0
  )

  return value === undefined ? {} : { session: value }
}

/**
 * A stop event: `Stop` in Claude Code, Codex and VS Code's shape, `stop` in Cursor, and
 * Copilot's own `agentStop` payload, which names no event but has a `stopReason`.
 */
const isStop = (payload: Record<string, unknown>): boolean =>
  payload.hook_event_name === 'Stop' ||
  payload.hook_event_name === 'stop' ||
  payload.hook_event_name === 'agentStop' ||
  ('stopReason' in payload && !('toolName' in payload))

/** Read the payload of a stop hook, or undefined when the payload is not one. */
export const readStopPayload = (text: string): StopPayload | undefined => {
  const payload = parse(text)

  if (!isRecord(payload) || !isStop(payload)) return undefined

  // Cursor counts the follow-ups its stop hooks sent in a row. The others say whether one did.
  const cursor = payload.hook_event_name === 'stop'
  const loops = typeof payload.loop_count === 'number' ? payload.loop_count : 0
  const continuing = cursor ? loops > 0 : payload.stop_hook_active === true
  const finished = !cursor || payload.status === undefined || payload.status === 'completed'

  return { reply: cursor ? 'followup' : 'decision', continuing, finished, ...sessionOf(payload) }
}

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
  const session = sessionOf(payload)
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : payload.toolName

  if (typeof tool === 'string' && /^[a-z]/.test(tool) && !EDIT_TOOLS.has(tool)) {
    return { files: [], reply, ...cwd, ...session }
  }

  const args = typeof payload.toolArgs === 'string' ? (parse(payload.toolArgs) ?? payload.toolArgs) : payload.toolArgs
  const input = payload.tool_input ?? args ?? payload.tool_info ?? payload
  const named = tool === 'apply_patch' ? patchPaths(input) : pathsIn(input)
  const files = [...new Set(named.filter(file => file.length > 0))]

  return { files, reply, ...cwd, ...session }
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

/** What the agent reads: what pawl did, then one JSON line per problem, as `--format agent` prints them. */
export const hookMessage = (
  result: CheckResult,
  fixed: boolean,
  when: 'edit' | 'stop' = 'edit'
): string | undefined => {
  // After a fix, what is still marked fixable needs an unsafe fix: "run pawl fix" would go round in circles.
  const findings = fixed ? result.findings.map(finding => ({ ...finding, fixable: false })) : result.findings
  const lines = formatAgent({ ...result, setup: [], findings })
    .split('\n')
    .filter(Boolean)

  if (lines.length === 0) return undefined

  const count = plural(result.findings.length, 'problem')
  const head =
    when === 'stop'
      ? [`You are not done yet: pawl found ${count} in the files you edited in this session.`]
      : [
          fixed
            ? `pawl applied the safe fixes and formatting to the files you just edited. ${count} left:`
            : `pawl found ${count} in the files you just edited:`
        ]
  const tail =
    when === 'stop'
      ? [
          'Fix them in the code, then finish. Do not add a disable comment (biome-ignore, eslint-disable, @ts-ignore): new ones fail the check.',
          'If one needs the user, such as a tool to install or a rule to change, say so and stop.'
        ]
      : [
          'Fix them in the code. Do not add a disable comment (biome-ignore, eslint-disable, @ts-ignore): new ones fail the check.'
        ]
  const more = (count: number): string =>
    `And ${plural(count, 'more line')}: run "${PAWL} check --changed --format agent" to see them all.`
  // The lines that fit next to the head and tail, with room kept for `reserve` more characters.
  const fitting = (reserve: number): string[] => {
    const kept: string[] = []
    let length = [...head, ...tail].join('\n').length + reserve

    for (const line of lines) {
      if (length + line.length + 1 > CONTEXT_LIMIT) break

      kept.push(line)
      length += line.length + 1
    }

    return kept
  }
  const all = fitting(0)
  // When some lines are left out, the line that says so needs its room too.
  const kept = all.length === lines.length ? all : fitting(more(lines.length).length + 1)

  if (kept.length < lines.length) tail.unshift(more(lines.length - kept.length))

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

/** How often in a row the stop hook sends the agent back before it hands the rest to the person. */
export const STOP_ROUNDS = 3

/** What the stop hook decides. */
export type StopVerdict =
  | { kind: 'done' }
  | { kind: 'back'; message: string; state: StopState }
  | { kind: 'hand-off'; count: number }

/** The findings that fail the check: the errors, or every finding when there are more warnings than the limit allows. */
const failing = (result: CheckResult): CheckResult['findings'] =>
  tooManyWarnings(result) ? result.findings : result.findings.filter(finding => finding.severity === 'error')

/**
 * What is left, without positions: fixing one problem moves the lines of the others, and that is
 * not the same as fixing them.
 */
const signatureOf = (findings: CheckResult['findings']): string =>
  createHash('sha256')
    .update(
      findings
        .map(finding => `${finding.file}\0${finding.rule}\0${finding.message}`)
        .sort()
        .join('\n')
    )
    .digest('hex')

/**
 * Send the agent back while new errors are left, at most `STOP_ROUNDS` times in a row, and not
 * again when the last round changed nothing: an agent that cannot fix a problem would go round in
 * circles, and the person watching should hear about it instead.
 */
export const stopVerdict = (
  result: CheckResult,
  fixed: boolean,
  continuing: boolean,
  previous: StopState | undefined
): StopVerdict => {
  const findings = failing(result)

  if (findings.length === 0) return { kind: 'done' }

  const signature = signatureOf(findings)
  const rounds = continuing ? (previous?.rounds ?? 0) : 0

  if (rounds >= STOP_ROUNDS || (continuing && previous?.signature === signature)) {
    return { kind: 'hand-off', count: findings.length }
  }

  const message = hookMessage({ ...result, setup: [], findings }, fixed, 'stop')

  return message === undefined ? { kind: 'done' } : { kind: 'back', message, state: { rounds: rounds + 1, signature } }
}

/** The JSON that sends the agent back to work. */
export const stopReply = (message: string, reply: StopReply): string =>
  JSON.stringify(reply === 'followup' ? { followup_message: message } : { decision: 'block', reason: message })

/** What the person hears when pawl lets the agent stop with problems left. */
export const handOffMessage = (count: number): string =>
  `pawl: ${plural(count, 'problem')} left in the files the agent edited. Run "${PAWL} check --changed" to see them.`
