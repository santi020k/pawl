import { existsSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { SKILL_MARKER } from '../src/setup/templates.ts'
import { project } from './helpers.ts'

const json = (root: string, file: string): unknown => JSON.parse(readFileSync(join(root, file), 'utf8'))

describe('setting up coding agents', () => {
  const agents = async (root: string) => planInit({ root, install: false, editor: false, agents: true })
  const paths = async (root: string) => (await agents(root)).actions.map(action => action.path)

  it('swaps the hook commands earlier versions wrote for the current one, in place', async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      '.claude/settings.json': {
        permissions: { allow: ['Bash(npm test)'] },
        hooks: {
          PostToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ran' }] },
            {
              matcher: 'Edit|Write|MultiEdit',
              hooks: [{ type: 'command', command: 'npx pawl check --changed --format agent' }]
            }
          ]
        }
      },
      '.cursor/hooks.json': { version: 1, hooks: { afterFileEdit: [{ command: 'npx pawl fix --changed' }] } }
    })

    applyPlan(await agents(root))

    expect(json(root, '.claude/settings.json')).toEqual({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        PostToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ran' }] },
          { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'npx --no pawl fix --hook' }] }
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }] }],
        PreToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit|Bash|PowerShell',
            hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }]
          }
        ]
      }
    })
    expect(json(root, '.cursor/hooks.json')).toEqual({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: 'npx --no pawl fix --hook' }],
        stop: [{ command: 'npx --no pawl check --hook' }]
      }
    })
    expect(await paths(root)).toEqual([])
  })

  it('swaps a hook that could install the unscoped pawl package for one that runs the local copy only', async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      '.claude/settings.json': {
        hooks: {
          PostToolUse: [
            { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'npx pawl fix --hook' }] }
          ]
        }
      }
    })

    applyPlan(await agents(root))

    expect(json(root, '.claude/settings.json')).toEqual({
      hooks: {
        PostToolUse: [
          { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'npx --no pawl fix --hook' }] }
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }] }],
        PreToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit|Bash|PowerShell',
            hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }]
          }
        ]
      }
    })
    expect(JSON.stringify(json(root, '.claude/settings.json'))).not.toContain('"npx pawl')
  })

  it('adds the stop hook next to a current edit hook, and keeps a stop hook of the user', async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      '.claude/settings.json': {
        hooks: {
          PostToolUse: [
            { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'npx --no pawl fix --hook' }] }
          ],
          Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }]
        }
      }
    })

    applyPlan(await agents(root))

    expect(json(root, '.claude/settings.json')).toEqual({
      hooks: {
        PostToolUse: [
          { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'npx --no pawl fix --hook' }] }
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'say done' }] },
          { hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }] }
        ],
        PreToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit|Bash|PowerShell',
            hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }]
          }
        ]
      }
    })
    expect(await paths(root)).toEqual([])
  })

  it('adds hooks for Cursor, Codex and Copilot only in repos that use them', async () => {
    const bare = project({ 'package.json': { name: 'fixture' } })

    expect((await paths(bare)).filter(path => /cursor|codex|github/.test(path))).toEqual([])

    const root = project({
      'package.json': { name: 'fixture' },
      '.codex/config.toml': 'model = "gpt-5"\n',
      '.github/copilot-instructions.md': '# Copilot\n'
    })
    const plan = await agents(root)

    applyPlan(plan)
    expect(plan.notes.join(' ')).toContain("Review pawl's hooks in Codex's /hooks.")
    expect(json(root, '.codex/hooks.json')).toEqual({
      hooks: {
        PostToolUse: [{ matcher: 'apply_patch', hooks: [{ type: 'command', command: 'npx --no pawl fix --hook' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }] }],
        PreToolUse: [
          { matcher: 'apply_patch|Bash', hooks: [{ type: 'command', command: 'npx --no pawl check --hook' }] }
        ]
      }
    })
    expect(json(root, '.github/hooks/pawl.json')).toEqual({
      version: 1,
      hooks: {
        postToolUse: [{ type: 'command', command: 'npx --no pawl fix --hook', timeoutSec: 60 }],
        agentStop: [{ type: 'command', command: 'npx --no pawl check --hook', timeoutSec: 60 }]
      }
    })
    // Nothing to add the second time, and no note about Codex either.
    const again = await agents(root)

    expect(again.actions).toEqual([])
    expect(again.notes.join(' ')).not.toContain('Codex')
  })

  it('leaves a hook file it cannot read, and says so', async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      '.claude/settings.json': '{ // ours\n "hooks": {} }\n'
    })
    const plan = await agents(root)

    expect(plan.actions.map(action => action.path)).not.toContain('.claude/settings.json')
    expect(plan.notes).toContain('.claude/settings.json could not be read, so pawl added no Claude Code hook.')
  })
})

describe('agent instructions Claude Code and Gemini CLI read', () => {
  const agents = async (root: string) => planInit({ root, install: false, editor: false, agents: true })
  const text = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

  it('writes a CLAUDE.md that imports AGENTS.md, which Claude Code does not read on its own', async () => {
    const root = project({ 'package.json': { name: 'fixture' } })

    applyPlan(await agents(root))

    expect(text(root, 'CLAUDE.md')).toBe('@AGENTS.md\n')
    expect(text(root, 'AGENTS.md')).toContain('npx --no pawl check --changed --format agent')
    expect((await agents(root)).actions).toEqual([])
  })

  it('adds the import to the end of an existing CLAUDE.md, wherever it is, and only once', async () => {
    const root = project({ 'package.json': { name: 'fixture' }, 'CLAUDE.md': '# Notes\n\nUse pnpm.\n' })
    const nested = project({ 'package.json': { name: 'fixture' }, '.claude/CLAUDE.md': '# Notes\n' })

    applyPlan(await agents(root))
    applyPlan(await agents(nested))

    expect(text(root, 'CLAUDE.md')).toBe('# Notes\n\nUse pnpm.\n\n@AGENTS.md\n')
    expect(text(nested, '.claude/CLAUDE.md')).toBe('# Notes\n\n@../AGENTS.md\n')
    expect(existsSync(join(nested, 'CLAUDE.md'))).toBe(false)
    expect((await agents(root)).actions).toEqual([])
  })

  it('leaves a CLAUDE.md alone that already imports AGENTS.md or is a link to it', async () => {
    const imports = project({ 'package.json': { name: 'fixture' }, 'CLAUDE.md': '@./AGENTS.md\n\n## Claude\n' })
    const linked = project({ 'package.json': { name: 'fixture' }, 'AGENTS.md': '# Agents\n' })

    symlinkSync('AGENTS.md', join(linked, 'CLAUDE.md'))

    const paths = async (root: string) => (await agents(root)).actions.map(action => action.path)

    expect(await paths(imports)).not.toContain('CLAUDE.md')
    expect(await paths(linked)).not.toContain('CLAUDE.md')
  })

  it('has Gemini CLI read AGENTS.md as well as the files it already reads, where the repo uses it', async () => {
    const fresh = project({ 'package.json': { name: 'fixture' }, '.gemini/.keep': '' })
    const named = project({
      'package.json': { name: 'fixture' },
      '.gemini/settings.json': { model: { name: 'gemini-3-pro' }, context: { fileName: 'CONTEXT.md' } }
    })

    applyPlan(await agents(fresh))
    applyPlan(await agents(named))

    expect(json(fresh, '.gemini/settings.json')).toEqual({ context: { fileName: ['GEMINI.md', 'AGENTS.md'] } })
    expect(json(named, '.gemini/settings.json')).toEqual({
      model: { name: 'gemini-3-pro' },
      context: { fileName: ['CONTEXT.md', 'AGENTS.md'] }
    })
    expect((await agents(named)).actions).toEqual([])
    expect((await agents(project({ 'package.json': { name: 'fixture' } }))).actions.map(a => a.path)).not.toContain(
      '.gemini/settings.json'
    )
  })
})

describe('the pawl skill', () => {
  const agents = async (root: string) => planInit({ root, install: false, editor: false, agents: true })
  const files = ['.claude/skills/pawl/SKILL.md', '.agents/skills/pawl/SKILL.md']

  it('writes the same skill where Claude Code looks and where Codex and Copilot look, once', async () => {
    const root = project({ 'package.json': { name: 'fixture' } })

    applyPlan(await agents(root))

    const [claude, shared] = files.map(file => readFileSync(join(root, file), 'utf8'))

    expect(claude).toBe(shared)
    expect(claude?.startsWith('---\nname: pawl\ndescription: ')).toBe(true)
    expect(claude).toContain('npx --no pawl check --changed --format agent')
    expect(claude).toContain('Run `pawl baseline`. It accepts every current finding')
    expect(claude).toContain('When you stop, a hook checks every file you edited in the session.')
    expect(claude).not.toMatch(/npx pawl /)
    expect((await agents(root)).actions).toEqual([])
  })

  it("updates pawl's own copy, and leaves one someone wrote alone", async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      '.claude/skills/pawl/SKILL.md': `---\nname: pawl\ndescription: old\n---\n\n${SKILL_MARKER}\n\nOld text.\n`,
      '.agents/skills/pawl/SKILL.md': '---\nname: pawl\ndescription: Ours.\n---\n\nOur own way.\n'
    })
    const plan = await agents(root)

    applyPlan(plan)

    expect(readFileSync(join(root, files[0] ?? ''), 'utf8')).not.toContain('Old text.')
    expect(readFileSync(join(root, files[1] ?? ''), 'utf8')).toContain('Our own way.')
    expect(plan.notes).toContain('.agents/skills/pawl/SKILL.md is not the one pawl writes, so pawl left it alone.')
  })
})
