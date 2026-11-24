import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { type CheckResult } from '../src/check/result.ts'
import { assertHookFlags, type Flags } from '../src/cli/args.ts'
import {
  handOffMessage,
  hookFiles,
  hookMessage,
  hookReply,
  hookSetupProblems,
  readPayload,
  readStdin,
  readStopPayload,
  STOP_ROUNDS,
  stopReply,
  stopVerdict
} from '../src/cli/hook.ts'
import { clearSession, editedFiles, readStopState, recordEdits, writeStopState } from '../src/cli/hook-state.ts'
import { type Finding } from '../src/types.ts'
import { project } from './helpers.ts'

const result = (findings: Finding[], extra: Partial<CheckResult> = {}): CheckResult => ({
  findings,
  baselined: 0,
  setup: [],
  engines: ['biome'],
  commands: ['biome check src/a.ts'],
  hasBaseline: true,
  canShrinkBaseline: false,
  nothingToCheck: false,
  ...extra
})

const debuggerFinding: Finding = {
  file: 'src/a.ts',
  line: 2,
  column: 1,
  engine: 'biome',
  engineRule: 'suspicious/noDebugger',
  rule: 'no-debugger',
  severity: 'error',
  message: 'This is an unexpected use of the debugger statement.',
  fixable: true
}

const payload = (value: object): string => JSON.stringify(value)

describe('reading what the agent edited', () => {
  it("takes Claude Code's file and answers it in additionalContext", () => {
    expect(
      readPayload(
        payload({
          hook_event_name: 'PostToolUse',
          cwd: '/repo',
          tool_name: 'Write',
          tool_input: { file_path: '/repo/src/a.ts', content: 'x' },
          tool_response: { success: true }
        })
      )
    ).toEqual({ files: ['/repo/src/a.ts'], cwd: '/repo', reply: 'context' })
  })

  it("reads Codex's files from the patch: added, updated and moved to, not deleted", () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const a = 1',
      '*** Update File: src/old.ts',
      '*** Move to: src/moved.ts',
      '@@',
      '*** Delete File: src/gone.ts',
      '*** End Patch'
    ].join('\n')

    expect(
      readPayload(payload({ hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: patch } }))
    ).toEqual({ files: ['src/new.ts', 'src/old.ts', 'src/moved.ts'], reply: 'context' })
  })

  it("takes Cursor's file and has no way to answer", () => {
    expect(readPayload(payload({ hook_event_name: 'afterFileEdit', file_path: '/repo/src/a.ts', edits: [] }))).toEqual({
      files: ['/repo/src/a.ts'],
      reply: 'none'
    })
  })

  it("reads Copilot's arguments, given as JSON in a string, and answers on stdout", () => {
    expect(
      readPayload(payload({ toolName: 'edit', toolArgs: JSON.stringify({ path: 'src/a.ts' }), cwd: '/repo' }))
    ).toEqual({ files: ['src/a.ts'], cwd: '/repo', reply: 'copilot' })
    // The shape Copilot sends for a hook written the way VS Code writes them.
    expect(
      readPayload(
        payload({
          hook_event_name: 'PostToolUse',
          tool_name: 'create',
          tool_input: { path: 'src/b.ts' },
          tool_result: { result_type: 'success' }
        })
      ).reply
    ).toBe('copilot')
  })

  it('names no files for a tool that edits nothing, where the host runs the hook after every tool', () => {
    expect(readPayload(payload({ toolName: 'view', toolArgs: { path: 'src/a.ts' } })).files).toEqual([])
    expect(readPayload(payload({ toolName: 'bash', toolArgs: { command: 'rm -rf build' } })).files).toEqual([])
  })

  it('reads every file of an edit that changes several, once each', () => {
    expect(
      readPayload(
        payload({
          hook_event_name: 'PostToolUse',
          tool_name: 'multi_replace_string_in_file',
          tool_input: { replacements: [{ filePath: '/r/a.ts' }, { filePath: '/r/b.ts' }, { filePath: '/r/a.ts' }] }
        })
      ).files
    ).toEqual(['/r/a.ts', '/r/b.ts'])
  })

  it('names no files when the payload cannot be read', () => {
    expect(readPayload('')).toEqual({ files: [], reply: 'none' })
    expect(readPayload('{"hook_event_name": "PostToolUse", "tool_inp')).toEqual({ files: [], reply: 'none' })
    expect(readPayload('[1, 2]')).toEqual({ files: [], reply: 'none' })
  })
})

describe('the files a hook looks at', () => {
  it('keeps edited files inside the project that still exist, as project paths', () => {
    const root = project({ 'src/a.ts': 'export const a = 1\n', 'src/b.ts': 'export const b = 1\n' })
    const outside = project({ 'c.ts': 'export const c = 1\n' })

    expect(
      hookFiles(root, {
        files: [join(root, 'src/a.ts'), 'src/b.ts', 'src/gone.ts', join(outside, 'c.ts'), root, 'src/a.ts'],
        reply: 'context'
      })
    ).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it("reads relative paths from the agent's folder", () => {
    const root = project({ 'packages/ui/src/a.ts': 'export const a = 1\n' })

    expect(hookFiles(root, { files: ['src/a.ts'], cwd: join(root, 'packages/ui'), reply: 'context' })).toEqual([
      'packages/ui/src/a.ts'
    ])
  })

  it('leaves out a folder named in place of a file, the root included', () => {
    const root = project({})

    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1\n')

    expect(hookFiles(root, { files: ['.', './', 'src', root], reply: 'context' })).toEqual([])
  })
})

describe('reading stdin', () => {
  it('reads the payload once stdin ends', async () => {
    const stdin = new PassThrough()

    stdin.end('{"a": 1}')

    expect(await readStdin(stdin)).toBe('{"a": 1}')
  })

  it('does not wait for a host that keeps stdin open after the payload', async () => {
    const stdin = new PassThrough()
    const started = Date.now()

    stdin.write('{"a":')
    setTimeout(() => stdin.write(' 1}'), 5)

    expect(await readStdin(stdin, 5000)).toBe('{"a": 1}')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('gives up at the deadline when nothing arrives, and reads nothing from a terminal', async () => {
    expect(await readStdin(new PassThrough(), 20)).toBe('')
    expect(await readStdin(Object.assign(new PassThrough(), { isTTY: true }))).toBe('')
  })
})

describe('what the agent reads back', () => {
  it('says nothing when nothing is left', () => {
    expect(hookMessage(result([]), true)).toBeUndefined()
  })

  it('lists what is left as agent lines, and does not send the agent back to "pawl fix" after a fix', () => {
    const fixed = hookMessage(result([debuggerFinding]), true) ?? ''
    const line = JSON.parse(fixed.split('\n')[1] ?? '{}') as Record<string, unknown>

    expect(fixed.split('\n')[0]).toBe(
      'pawl applied the safe fixes and formatting to the files you just edited. 1 problem left:'
    )
    expect(line).toMatchObject({ file: 'src/a.ts', line: 2, rule: 'biome:suspicious/noDebugger' })
    expect(line.fix).not.toBe('Run "pawl fix".')
    expect(fixed).toContain('Do not add a disable comment')
    expect(hookMessage(result([debuggerFinding]), false)).toContain('"fix":"Run \\"pawl fix\\"."')
  })

  it('stays under the 10,000 characters hosts keep, and says how to see the rest', () => {
    const many = Array.from({ length: 400 }, (_, index) => ({ ...debuggerFinding, line: index + 1 }))
    const message = hookMessage(result(many), true) ?? ''

    expect(message.length).toBeLessThanOrEqual(9000)
    expect(message).toMatch(/And \d+ more lines: run "npx --no pawl check --changed --format agent" to see them all\./)
  })

  it("answers in each host's shape, and not at all where the host reads nothing", () => {
    expect(JSON.parse(hookReply('left', 'context') ?? '')).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'left' }
    })
    expect(JSON.parse(hookReply('left', 'copilot') ?? '')).toEqual({ additionalContext: 'left' })
    expect(hookReply('left', 'none')).toBeUndefined()
  })

  it('keeps setup problems for the person, and only the ones that stopped the check', () => {
    const setup: CheckResult['setup'] = [
      { code: 'biome-missing', message: 'Biome is not installed.', fix: 'Run "npm install -D @biomejs/biome".' },
      { code: 'biome-config-stale', message: 'biome.json has drifted from the policy.' }
    ]

    expect(hookSetupProblems(result([], { setup }))).toBe(
      'pawl: Biome is not installed. Run "npm install -D @biomejs/biome".'
    )
    expect(hookSetupProblems(result([], { setup: setup.slice(1) }))).toBeUndefined()
  })
})

describe('the --hook flag', () => {
  it('refuses what would name the files twice or change the shape of the answer', () => {
    expect(() => assertHookFlags({ hook: true } as Flags, [])).not.toThrow()
    expect(() => assertHookFlags({ hook: true, changed: true, format: 'json' } as Flags, ['a.ts'])).toThrow(
      "--hook reads the files from the hook's input and answers in the agent's own shape. Leave out a list of files, --changed or --format."
    )
  })
})

describe('the session an edit belongs to', () => {
  it('names it the way each host does', () => {
    const edit = { tool_name: 'Write', tool_input: { file_path: 'src/a.ts' } }

    expect(readPayload(payload({ ...edit, hook_event_name: 'PostToolUse', session_id: 'claude-1' })).session).toBe(
      'claude-1'
    )
    expect(
      readPayload(payload({ toolName: 'edit', toolArgs: { path: 'src/a.ts' }, sessionId: 'copilot-1' })).session
    ).toBe('copilot-1')
    expect(
      readPayload(payload({ hook_event_name: 'afterFileEdit', file_path: 'src/a.ts', conversation_id: 'cursor-1' }))
        .session
    ).toBe('cursor-1')
    expect(readPayload(payload(edit)).session).toBeUndefined()
  })
})

describe('reading a stop', () => {
  it("reads Claude Code's and Codex's Stop, and whether a stop hook already sent the agent back", () => {
    expect(readStopPayload(payload({ hook_event_name: 'Stop', session_id: 's', stop_hook_active: false }))).toEqual({
      reply: 'decision',
      continuing: false,
      finished: true,
      session: 's'
    })
    expect(
      readStopPayload(payload({ hook_event_name: 'Stop', session_id: 's', stop_hook_active: true, turn_id: 't' }))
    ).toMatchObject({ reply: 'decision', continuing: true })
  })

  it("reads Copilot's agentStop in its own shape and in VS Code's", () => {
    expect(
      readStopPayload(payload({ sessionId: 'c', cwd: '/repo', stopReason: 'end_turn', stop_hook_active: false }))
    ).toEqual({ reply: 'decision', continuing: false, finished: true, session: 'c' })
    expect(
      readStopPayload(
        payload({ hook_event_name: 'Stop', session_id: 'c', stop_reason: 'end_turn', stop_hook_active: true })
      )
    ).toMatchObject({ reply: 'decision', continuing: true, session: 'c' })
  })

  it("reads Cursor's stop: a follow-up message, its loop count, and only a turn that completed", () => {
    expect(
      readStopPayload(payload({ hook_event_name: 'stop', status: 'completed', loop_count: 0, conversation_id: 'k' }))
    ).toEqual({ reply: 'followup', continuing: false, finished: true, session: 'k' })
    expect(readStopPayload(payload({ hook_event_name: 'stop', status: 'completed', loop_count: 2 }))).toMatchObject({
      continuing: true
    })
    expect(readStopPayload(payload({ hook_event_name: 'stop', status: 'aborted', loop_count: 0 }))).toMatchObject({
      finished: false
    })
  })

  it('is not a stop when the payload is an edit or not JSON', () => {
    expect(readStopPayload(payload({ hook_event_name: 'PostToolUse', tool_name: 'Write' }))).toBeUndefined()
    expect(readStopPayload(payload({ toolName: 'edit', toolArgs: {} }))).toBeUndefined()
    expect(readStopPayload('not json')).toBeUndefined()
  })
})

describe('deciding at a stop', () => {
  const warning: Finding = { ...debuggerFinding, severity: 'warn', rule: 'no-console', message: 'No console.' }

  it('lets the agent finish when no errors are left, even with warnings', () => {
    expect(stopVerdict(result([]), false, false, undefined)).toEqual({ kind: 'done' })
    expect(stopVerdict(result([warning]), false, false, undefined)).toEqual({ kind: 'done' })
  })

  it('sends the agent back with the errors only, and counts the round', () => {
    const verdict = stopVerdict(result([debuggerFinding, warning]), false, false, undefined)

    expect(verdict).toMatchObject({ kind: 'back', state: { rounds: 1 } })
    if (verdict.kind !== 'back') return
    expect(verdict.message.split('\n')[0]).toBe(
      'You are not done yet: pawl found 1 problem in the files you edited in this session.'
    )
    expect(verdict.message).toContain('noDebugger')
    expect(verdict.message).not.toContain('No console.')
    expect(verdict.message).toContain('If one needs the user')
  })

  it('counts warnings too when there are more than the limit allows', () => {
    const verdict = stopVerdict(result([warning, warning], { maxWarnings: 1 }), false, false, undefined)

    expect(verdict.kind === 'back' && verdict.message).toContain('pawl found 2 problems')
  })

  it('sends the agent back again while the problems change, up to the round limit', () => {
    const first = stopVerdict(result([debuggerFinding]), false, false, undefined)
    const other: Finding = { ...debuggerFinding, file: 'src/b.ts' }

    if (first.kind !== 'back') throw new Error('expected the agent to be sent back')

    const second = stopVerdict(result([other]), false, true, first.state)

    expect(second).toMatchObject({ kind: 'back', state: { rounds: 2 } })
    expect(stopVerdict(result([other]), false, true, { rounds: STOP_ROUNDS, signature: 'x' })).toEqual({
      kind: 'hand-off',
      count: 1
    })
  })

  it('hands off when the last round changed nothing, even if the lines moved', () => {
    const first = stopVerdict(result([debuggerFinding]), false, false, undefined)

    if (first.kind !== 'back') throw new Error('expected the agent to be sent back')

    expect(stopVerdict(result([{ ...debuggerFinding, line: 9 }]), false, true, first.state)).toEqual({
      kind: 'hand-off',
      count: 1
    })
  })

  it('starts again at the first round when no stop hook sent the agent back', () => {
    expect(stopVerdict(result([debuggerFinding]), false, false, { rounds: STOP_ROUNDS, signature: 'x' })).toMatchObject(
      { kind: 'back', state: { rounds: 1 } }
    )
  })

  it("answers in each host's shape", () => {
    expect(JSON.parse(stopReply('fix it', 'decision'))).toEqual({ decision: 'block', reason: 'fix it' })
    expect(JSON.parse(stopReply('fix it', 'followup'))).toEqual({ followup_message: 'fix it' })
    expect(handOffMessage(2)).toBe(
      'pawl: 2 problems left in the files the agent edited. Run "npx --no pawl check --changed" to see them.'
    )
  })
})

describe('what the hooks remember', () => {
  it('keeps the edits of each project and session apart, each file once, until the session is cleared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawl-hook-state-'))

    recordEdits('/repo', 's1', ['src/a.ts', 'src/b.ts'], dir)
    recordEdits('/repo', 's1', ['src/a.ts'], dir)
    recordEdits('/repo', 's2', ['src/c.ts'], dir)
    recordEdits('/other', 's1', ['src/d.ts'], dir)
    writeStopState('/repo', 's1', { rounds: 2, signature: 'abc' }, dir)

    expect(editedFiles('/repo', 's1', dir)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(editedFiles('/repo', 's2', dir)).toEqual(['src/c.ts'])
    expect(readStopState('/repo', 's1', dir)).toEqual({ rounds: 2, signature: 'abc' })
    expect(readStopState('/repo', 's2', dir)).toBeUndefined()

    clearSession('/repo', 's1', dir)

    expect(editedFiles('/repo', 's1', dir)).toEqual([])
    expect(readStopState('/repo', 's1', dir)).toBeUndefined()
    expect(editedFiles('/other', 's1', dir)).toEqual(['src/d.ts'])
  })

  it('forgets nothing it cannot write, and never throws', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pawl-hook-state-')), 'a-file')

    writeFileSync(file, '')
    // A file where the folder should be: every write fails, and every read finds nothing.
    expect(() => recordEdits('/repo', 's', ['src/a.ts'], file)).not.toThrow()
    expect(() => writeStopState('/repo', 's', { rounds: 1, signature: 'x' }, file)).not.toThrow()
    expect(editedFiles('/repo', 's', file)).toEqual([])
    expect(() => clearSession('/repo', 's', file)).not.toThrow()
  })
})
