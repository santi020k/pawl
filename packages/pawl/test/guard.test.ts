import { describe, expect, it } from 'vitest'
import { guardFinding, guardReply, readGuardPayload } from '../src/cli/guard.ts'
import { project } from './helpers.ts'

const claude = (tool: string, input: Record<string, unknown>): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: tool, tool_input: input })

const codex = (tool: string, input: Record<string, unknown>): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', turn_id: 't', tool_name: tool, tool_input: input })

const decide = (root: string, text: string, copilot = true): Record<string, unknown> | undefined => {
  const payload = readGuardPayload(text, { env: {}, copilot })

  if (!payload) return undefined

  const reply = guardReply(payload, guardFinding(root, payload))

  return reply === undefined ? {} : (JSON.parse(reply) as Record<string, unknown>)
}

const decision = (reply: Record<string, unknown> | undefined): unknown =>
  (reply?.hookSpecificOutput as Record<string, unknown> | undefined)?.permissionDecision ?? reply?.permissionDecision

describe('the guard before an agent tool runs', () => {
  const root = project({ 'package.json': { name: 'app' } })

  it('asks the person in Claude Code before the baseline, the policy or an engine config changes', () => {
    for (const file of [
      '.pawl/baseline.json',
      `${root}/pawl.config.ts`,
      'biome.json',
      'packages/web/eslint.config.js'
    ]) {
      const reply = decide(root, claude('Edit', { file_path: file, old_string: 'a', new_string: 'b' }))

      expect(decision(reply), file).toBe('ask')
      expect(JSON.stringify(reply)).toContain('pawl')
    }
  })

  it('asks before pawl baseline, however pawl is run, and before a command writes the baseline', () => {
    for (const command of [
      'npx --no pawl baseline',
      'pnpm exec pawl baseline',
      'node packages/pawl/dist/cli.js baseline',
      'echo "{}" > .pawl/baseline.json',
      'git checkout main -- .pawl/baseline.json',
      'rm .pawl/baseline.json'
    ])
      expect(decision(decide(root, claude('Bash', { command }))), command).toBe('ask')
  })

  it('lets everything else through without a word', () => {
    expect(decide(root, claude('Edit', { file_path: 'src/index.ts' }))).toEqual({})
    expect(decide(root, claude('Bash', { command: 'cat .pawl/baseline.json && npx --no pawl check' }))).toEqual({})
    expect(decide(root, claude('Bash', { command: 'git diff -- .pawl/baseline.json' }))).toEqual({})
    expect(decide(root, claude('Write', { file_path: '/elsewhere/biome.json' }))).toEqual({})
  })

  it('refuses a change to the baseline in Codex, which cannot ask, and lets config edits through', () => {
    const patch = '*** Begin Patch\n*** Update File: .pawl/baseline.json\n@@\n-1\n+2\n*** End Patch\n'
    const refused = decide(root, codex('apply_patch', { command: patch }))

    expect(decision(refused)).toBe('deny')
    expect(decision(decide(root, codex('Bash', { command: 'npx --no pawl baseline' })))).toBe('deny')
    expect(
      decide(root, codex('apply_patch', { command: '*** Begin Patch\n*** Update File: biome.json\n*** End Patch' }))
    ).toEqual({})
  })

  it("asks in Copilot's own shape, read only from the guard's command", () => {
    const text = JSON.stringify({ toolName: 'edit', toolArgs: JSON.stringify({ path: '.pawl/baseline.json' }) })

    expect(decide(root, text)).toMatchObject({ permissionDecision: 'ask' })
    expect(decide(root, text, false)).toBeUndefined()
    expect(decide(root, JSON.stringify({ toolName: 'edit', toolArgs: {}, toolResult: {} }))).toBeUndefined()
  })

  it('reads no other payload as one before a tool', () => {
    for (const text of [
      JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '.pawl/baseline.json' }
      }),
      JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false }),
      JSON.stringify({ hook_event_name: 'afterFileEdit', file_path: '.pawl/baseline.json' }),
      JSON.stringify({ stopReason: 'end_turn' }),
      'not json'
    ])
      expect(readGuardPayload(text, { env: {} }), text).toBeUndefined()
  })
})
