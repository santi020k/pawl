import { join } from 'node:path'
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

  it('asks from a folder of a monorepo, for the files at the root of its repository', () => {
    const repo = project({ '.git/HEAD': 'ref: refs/heads/main\n', 'packages/web/package.json': { name: 'web' } })
    const web = join(repo, 'packages/web')
    const edit = (file: string): string =>
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's',
        cwd: web,
        tool_name: 'Edit',
        tool_input: { file_path: file, old_string: 'a', new_string: 'b' }
      })

    expect(decision(decide(web, edit(join(repo, '.pawl/baseline.json'))))).toBe('ask')
    expect(decision(decide(web, edit(join(repo, 'biome.json'))))).toBe('ask')
    expect(decision(decide(web, claude('Bash', { command: 'echo {} > ../../.pawl/baseline.json' })))).toBe('ask')
    expect(decide(web, edit('/elsewhere/biome.json'))).toEqual({})
  })

  it('reads a command for what it runs and writes, not for the words in its strings or what it only reads', () => {
    for (const command of [
      'cat .pawl/baseline.json 2>&1 | head -40',
      'cat .pawl/baseline.json 2>/dev/null',
      "jq '.findings | length' .pawl/baseline.json > /tmp/count.json",
      'cp .pawl/baseline.json /tmp/before.json',
      'git commit -m "chore: record the pawl baseline"',
      "git commit -F - <<'EOF'\nchore: record the pawl baseline\n\nThe user ran pawl baseline.\nEOF",
      'grep -rn "pawl baseline" docs',
      "echo 'Run pawl baseline to accept them' >> notes.md",
      'npx --no pawl check --since origin/main # not pawl baseline',
      'pnpm --filter @santi020k/pawl test baseline',
      'diff <(git show main:.pawl/baseline.json) .pawl/baseline.json',
      'node -e "console.log(Object.keys(require(\'./.pawl/baseline.json\').findings).length)"',
      'cat biome.json',
      'cp biome.json /tmp/biome.json',
      'cat fixtures/baseline.json > fixtures/copy.json'
    ])
      expect(decide(root, codex('Bash', { command })), command).toEqual({})
  })

  it('refuses what writes the baseline however the command spells it', () => {
    for (const command of [
      "sed --in-place 's/1/2/' .pawl/baseline.json",
      "perl -pi -e 's/1/2/' .pawl/baseline.json",
      'cp /tmp/old.json ./.pawl/baseline.json',
      'cp /tmp/baseline.json .pawl/',
      'git checkout main -- .pawl',
      `echo {} > ${root}/.pawl/baseline.json`,
      'bash -c "npx --no pawl baseline"',
      'echo "$(npx --no pawl baseline)"',
      'npx --no pawl \\\n  baseline',
      "node -e \"require('fs').writeFileSync('.pawl/baseline.json', '{}')\"",
      "python3 - <<'EOF'\nimport json\nopen('.pawl/baseline.json', 'w').write('{}')\nEOF",
      "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: .pawl/baseline.json\n@@\n-1\n+2\n*** End Patch\nEOF",
      String.raw`Set-Content -Path .pawl\baseline.json -Value '{}'`,
      String.raw`'{}' | Out-File .pawl\baseline.json`,
      String.raw`echo {} > .pawl\baseline.json`,
      String.raw`Copy-Item C:\temp\old.json .pawl\baseline.json`,
      String.raw`Remove-Item -Recurse .pawl`
    ])
      expect(decision(decide(root, codex('Bash', { command }))), command).toBe('deny')
  })

  it('asks before a command writes the policy or an engine config, and only Claude Code', () => {
    for (const command of [
      `sed -i 's/"error"/"off"/' biome.json`,
      "echo '{}' > pawl.config.json",
      'cp /tmp/eslint.config.js packages/web/eslint.config.js'
    ]) {
      expect(decision(decide(root, claude('Bash', { command }))), command).toBe('ask')
      expect(decide(root, codex('Bash', { command })), command).toEqual({})
    }

    expect(decision(decide(root, claude('PowerShell', { command: 'npx --no pawl baseline' })))).toBe('ask')
  })

  it('refuses a git command that rewrites a folder or a pattern holding the baseline', () => {
    const repo = project({
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.pawl/baseline.json': { findings: {} },
      'pawl.config.json': {},
      'src/index.ts': 'export {}\n',
      'packages/web/package.json': { name: 'web' },
      'packages/web/eslint.config.js': 'export default []\n'
    })
    const web = join(repo, 'packages/web')
    const bash = (cwd: string, command: string): string =>
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's',
        turn_id: 't',
        cwd,
        tool_name: 'Bash',
        tool_input: { command }
      })

    for (const command of [
      'git restore .',
      'git restore ./',
      'git restore --source=HEAD~1 .',
      'git restore -s main -- .',
      'git checkout .',
      'git checkout main -- .',
      'git checkout -- .pawl/',
      'git restore :/',
      "git restore ':(top)'",
      "git restore ':!src'",
      "git restore '*'",
      `git restore ${repo}`,
      'git rm -r --cached .'
    ])
      expect(decision(decide(repo, bash(repo, command))), command).toBe('deny')

    for (const command of ['git restore ../..', 'git restore :/', 'git checkout main -- ../../.pawl'])
      expect(decision(decide(web, bash(web, command))), command).toBe('deny')

    const policy = guardFinding(repo, { host: 'claude', files: [], command: 'git restore .', cwd: repo })

    expect(policy?.files).toEqual(expect.arrayContaining(['.pawl/baseline.json', 'pawl.config.json']))
    expect(guardFinding(web, { host: 'claude', files: [], command: 'git restore .', cwd: web })?.files).toEqual([
      'packages/web/eslint.config.js'
    ])

    for (const command of [
      'git restore src',
      'git restore src/index.ts',
      "git restore 'src/*.ts'",
      'git checkout main',
      'git status .'
    ])
      expect(decide(repo, bash(repo, command)), command).toEqual({})
  })

  it('follows a cd before a write, and checks a write after a subshell from both folders', () => {
    const repo = project({ '.pawl/baseline.json': { findings: {} }, 'src/index.ts': 'export {}\n' })
    const finding = (command: string) => guardFinding(repo, { host: 'claude', files: [], command, cwd: repo })

    for (const command of [
      "cd .pawl && printf '{}' > baseline.json",
      'cd .pawl; rm baseline.json',
      'pushd .pawl && tee baseline.json < /dev/null',
      'cd src && cd ../.pawl && truncate -s 0 baseline.json',
      "(cd src) && printf '{}' > .pawl/baseline.json",
      'cd .pawl && git restore .',
      'git -C .pawl restore .',
      'git -C src -C ../.pawl checkout -- baseline.json',
      'git -C "$PWD" restore .',
      'git -C ~/repo checkout -- .'
    ])
      expect(finding(command)?.files, command).toContain('.pawl/baseline.json')

    for (const command of ["cd src && printf '{}' > baseline.json", 'cd .pawl && cat baseline.json'])
      expect(finding(command), command).toBeUndefined()
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
