import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { type CheckResult } from '../src/check/result.ts'
import { assertHookFlags, type Flags } from '../src/cli/args.ts'
import { hookFiles, hookMessage, hookReply, hookSetupProblems, readPayload, readStdin } from '../src/cli/hook.ts'
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
    expect(message).toMatch(/And \d+ more lines: run "npx pawl check --changed --format agent" to see them all\./)
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
