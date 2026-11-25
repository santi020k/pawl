// cspell:ignore chek chnged
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, it as test } from 'vitest'
import { BASELINE_FILE } from '../src/check/baseline.ts'
import { check } from '../src/check/check.ts'
import { formatAgent } from '../src/check/output.ts'
import { exitCode } from '../src/check/result.ts'
import { BIOME_PRESET, biomeTechPreset } from '../src/engines/biome/config.ts'
import { planAdd } from '../src/setup/add.ts'
import { formatWritten, planInit, recordBaseline } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { VERSION } from '../src/version.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const json = (root: string, file: string): unknown => JSON.parse(readFileSync(join(root, file), 'utf8'))

const init = async (root: string, options: Parameters<typeof planInit>[0] | object = {}) => {
  const plan = await planInit({ root, install: false, ...options })

  applyPlan(plan)
  await formatWritten(
    root,
    plan.actions.map(action => action.path)
  )

  return { plan, baselined: await recordBaseline(root, plan) }
}

const LEGACY = `var legacy: any = 1
// eslint-disable-next-line eqeqeq
export const same = legacy == 2
`

const AGENT_SLOP = `import { nothing } from 'made-up-package'

export function load(input: any) {
  try {
    return JSON.parse(input)
  } catch {}
  // @ts-ignore
  return nothing
}
`

describe('a real project, with the real Biome', { timeout: 60_000 }, () => {
  it('sets up, baselines what exists, and fails only on what is new', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module', devDependencies: { typescript: '^7.0.0' } },
      'src/old.ts': LEGACY
    })

    link(root)

    const { plan, baselined } = await init(root)

    expect(plan.engines).toEqual(['biome'])
    expect(plan.actions.map(action => action.path)).toEqual([
      'biome.json',
      '.pawl/biome-overrides.json',
      'package.json',
      '.vscode/settings.json',
      '.vscode/extensions.json',
      '.vscode/tasks.json'
    ])
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET] })
    expect(json(root, 'package.json')).toMatchObject({
      scripts: { check: 'pawl check', fix: 'pawl fix' },
      devDependencies: { '@santi020k/pawl': `^${VERSION}` }
    })
    expect(baselined).toBe(3)
    expect(json(root, BASELINE_FILE)).toEqual({
      version: 1,
      findings: { 'src/old.ts': { '@typescript-eslint/no-explicit-any': 1, eqeqeq: 1, 'no-var': 1 } },
      suppressions: { 'src/old.ts': 1 },
      // No test files, so nothing to count, which is not the same as a baseline that never counted.
      tests: {}
    })

    // The files pawl wrote pass its own check, and the old findings are allowed.
    const clean = await check({ root })

    expect(clean.findings).toEqual([])
    expect(clean.setup).toEqual([])
    expect(clean.baselined).toBe(3)
    expect(exitCode(clean, true)).toBe(0)

    // Running init again changes nothing.
    expect((await planInit({ root, install: false })).actions).toEqual([])

    write(root, { 'src/new.ts': AGENT_SLOP })

    const dirty = await check({ root })

    expect(dirty.findings.map(finding => `${finding.file}:${finding.line} ${finding.rule}`)).toEqual([
      'src/new.ts:1 import/no-extraneous-dependencies',
      'src/new.ts:3 @typescript-eslint/no-explicit-any',
      'src/new.ts:6 no-empty',
      'src/new.ts:7 pawl/no-new-disable',
      'src/new.ts:7 @typescript-eslint/ban-ts-comment'
    ])
    expect(exitCode(dirty)).toBe(1)
    expect(dirty.commands).toEqual(['biome check .'])

    const agent = formatAgent(await check({ root, files: ['src/new.ts'] }))
      .split('\n')
      .map(line => JSON.parse(line) as { rule: string; fix?: string })

    expect(agent[0]).toMatchObject({
      rule: 'biome:correctness/noUndeclaredDependencies',
      fix: expect.stringContaining('package.json')
    })
  })

  it('formats and fixes with "fix", and leaves the rest to people', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/a.js': 'var   answer = "forty-two";\nexport { answer }\n'
    })

    link(root)
    await init(root, { editor: false })
    write(root, { 'src/b.js': 'import {b} from "./a.js"\nimport {a} from "./a.js"\nexport   const sum = a+b;\n' })

    const before = await check({ root })

    expect(before.findings.map(finding => finding.rule)).toEqual(
      expect.arrayContaining(['pawl/format', 'pawl/organize-imports'])
    )

    const after = await check({ root, fix: true })

    expect(after.findings).toEqual([])
    expect(readFileSync(join(root, 'src/b.js'), 'utf8')).toBe(
      "import { a, b } from './a.js'\nexport const sum = a + b\n"
    )
  })

  it('writes the React preset for React projects and reports drift from the policy', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module', dependencies: { react: '^19.0.0' } },
      'generated/out.js': 'var bad = 1; debugger\n'
    })

    link(root)
    await init(root, { editor: false })
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET, biomeTechPreset('react')] })
    expect(json(root, BASELINE_FILE)).toMatchObject({ findings: { 'generated/out.js': expect.any(Object) } })

    write(root, { 'pawl.config.json': '{ "ignore": ["generated/**"], "rules": { "no-debugger": "warn" } }\n' })

    const drifted = await check({ root })

    expect(drifted.setup.map(issue => issue.code)).toEqual(['biome-config-stale'])
    // The ignore list applies at once, before the engine config is synced.
    expect(drifted.findings).toEqual([])
    expect(drifted.baselined).toBe(0)
    expect(exitCode(drifted)).toBe(0)
    expect(exitCode(drifted, true)).toBe(2)

    const plan = await planInit({ root, install: false, editor: false })

    expect(plan.actions.map(action => `${action.kind} ${action.path}`)).toEqual([
      expect.stringMatching(/^create \.pawl\/backups\/biome-[a-f0-9]{64}\.json$/),
      'update biome.json',
      'update .pawl/biome-overrides.json'
    ])
    applyPlan(plan)
    await formatWritten(root, ['biome.json'])
    expect(json(root, 'biome.json')).toEqual({
      extends: [BIOME_PRESET, biomeTechPreset('react')],
      files: { includes: ['!generated'] },
      linter: { rules: { suspicious: { noDebugger: 'warn' } } }
    })

    const synced = await check({ root })

    expect(synced.setup).toEqual([])
    expect(synced.findings).toEqual([])
    expect(synced.baselined).toBe(0)
  })

  it('keeps an existing Biome config and puts the standard underneath it', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true },
      'biome.json': { formatter: { lineWidth: 80 } }
    })

    link(root)

    const { plan } = await init(root, { editor: false })

    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET], formatter: { lineWidth: 80 } })
    expect(plan.notes.join(' ')).toContain('still override the standard')
  })

  it('stays on ESLint when asked to keep what the repo has', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'eslint.config.js': 'export default []\n'
    })
    const plan = await planInit({ root, mode: 'keep', install: false, editor: false })

    expect(plan.engines).toEqual(['eslint'])
    expect(plan.formatter).toBe('biome')
    expect(plan.policy.engine).toBe('eslint')
    expect(plan.actions.map(action => action.path)).toEqual([
      'pawl.config.ts',
      'biome.json',
      '.pawl/biome-overrides.json',
      'package.json'
    ])
    applyPlan(plan)
    expect(readFileSync(join(root, 'pawl.config.ts'), 'utf8')).toContain("engine: 'eslint'")
    // ESLint lints, so Biome is only there to format.
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET], linter: { enabled: false } })
    expect(json(root, 'package.json')).toMatchObject({
      devDependencies: {
        '@santi020k/pawl': `^${VERSION}`,
        '@biomejs/biome': '2.6.8',
        eslint: '^10.0.0',
        '@eslint/js': '^10.0.0'
      }
    })
  })

  it('does not count a legacy .eslintrc as ESLint running, and points to migrate', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module', devDependencies: { eslint: '^9.0.0' } },
      '.eslintrc.json': { rules: { 'no-console': 'off' } }
    })
    const plan = await planInit({ root, install: false, editor: false })

    // ESLint reads flat config only, so with an .eslintrc alone Biome is the one linter.
    expect(plan.engines).toEqual(['biome'])
    expect(plan.actions.map(action => action.path)).toEqual([
      'biome.json',
      '.pawl/biome-overrides.json',
      'package.json'
    ])
    expect(plan.notes).toContain(
      '.eslintrc.json is a legacy ESLint config, which pawl does not run. Run "pawl migrate" in place of "pawl init" to carry its rules into the policy, or remove ESLint and the file when you are ready.'
    )

    // Run by "pawl migrate", which has just carried the rules over, it does not send you back there.
    const migrated = await planInit({ root, install: false, editor: false, migrated: true })

    expect(migrated.notes).toContain(
      '.eslintrc.json is a legacy ESLint config. Its rules are in the policy now, so you can remove the file when you are ready.'
    )
    expect(migrated.notes.join(' ')).not.toContain('pawl migrate')
  })

  it.runIf(existsSync(join(PACKAGE_ROOT, 'dist/index.js')))(
    'writes a flat config when the repo keeps ESLint and only has a legacy .eslintrc',
    async () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        '.eslintrc.json': { rules: { 'no-console': 'off' } },
        'src/a.js': 'debugger\n'
      })

      link(root, { eslint: true })

      const plan = await planInit({ root, mode: 'keep', install: false, editor: false })

      expect(plan.engines).toEqual(['eslint'])
      expect(plan.actions.map(action => action.path)).toEqual([
        'pawl.config.ts',
        'biome.json',
        '.pawl/biome-overrides.json',
        'eslint.config.js',
        'package.json'
      ])
      expect(plan.notes.join(' ')).toContain(
        '.eslintrc.json is a legacy ESLint config, which ESLint no longer reads now that eslint.config.js is there.'
      )
      applyPlan(plan)

      // Without the flat config, ESLint would stop with "couldn't find an eslint.config file".
      const result = await check({ root })

      expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
      expect(result.findings.map(finding => finding.rule)).toContain('no-debugger')
    }
  )

  it('adds ESLint next to Biome for frameworks Biome does not fully lint, and sets up CI and agents on request', async () => {
    const root = project({
      'package.json': {
        name: 'fixture',
        private: true,
        packageManager: 'pnpm@11.6.0',
        dependencies: { vue: '^3.5.0' }
      },
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'turbo.json': {},
      'packages/ui/package.json': { name: 'ui' }
    })
    const plan = await planInit({ root, workflow: true, agents: true })

    expect(plan.engines).toEqual(['biome', 'eslint'])
    expect(plan.install).toBe('pnpm add -D -w @santi020k/pawl @biomejs/biome@2.6.8 eslint')
    expect(plan.actions.map(action => action.path)).toEqual([
      'biome.json',
      '.pawl/biome-overrides.json',
      'eslint.config.js',
      'package.json',
      '.vscode/settings.json',
      '.vscode/extensions.json',
      '.vscode/tasks.json',
      '.github/workflows/pawl.yml',
      '.claude/settings.json',
      'AGENTS.md',
      'CLAUDE.md',
      '.claude/skills/pawl/SKILL.md',
      '.agents/skills/pawl/SKILL.md'
    ])
    expect(plan.notes.join(' ')).toContain('covers all 1 package.')
    expect(plan.actions.find(action => action.path === '.github/workflows/pawl.yml')?.summary).toContain(
      '"pawl check --ci --format github"'
    )

    applyPlan(plan)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toContain("import { eslint } from '@santi020k/pawl'")
    const workflow = readFileSync(join(root, '.github/workflows/pawl.yml'), 'utf8')

    expect(workflow).toContain('pnpm install --frozen-lockfile')
    // Every action is pinned to a commit, and the doctor report is kept even when the check fails.
    expect(workflow.match(/uses: \S+/g)?.every(line => /@[0-9a-f]{40}$/.test(line))).toBe(true)
    expect(workflow).toContain('run: npx --no pawl check --ci --format github\n')
    expect(workflow).toContain('run: npx --no pawl doctor --format json > pawl-doctor.json')
    expect(workflow).toContain('path: pawl-doctor.json')
    expect(workflow.match(/if: always\(\)/g)).toHaveLength(2)
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(json(root, '.claude/settings.json')).toMatchObject({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [{ type: 'command', command: 'npx --no pawl fix --hook' }]
          }
        ]
      }
    })
  })
})

describe.runIf(existsSync(join(PACKAGE_ROOT, 'dist/index.js')))(
  'engine parity, with the real ESLint',
  { timeout: 60_000 },
  () => {
    const source = 'var count = 1\ndebugger\nif (count == 2) {\n}\nexport { count }\n'
    const shared = ['eqeqeq', 'no-debugger', 'no-empty', 'no-var']

    test('reports the same neutral rules from Biome and from ESLint', async () => {
      const biomeRoot = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'src/a.js': source
      })
      const eslintRoot = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'pawl.config.json': '{ "engine": "eslint" }\n',
        'biome.json': `{\n  "extends": ["${BIOME_PRESET}"],\n  "linter": { "enabled": false }\n}\n`,
        'eslint.config.js': "import { eslint } from '@santi020k/pawl'\n\nexport default eslint()\n",
        'src/a.js': source
      })

      link(biomeRoot)
      link(eslintRoot, { eslint: true })
      await init(biomeRoot, { editor: false })

      // Start both from an empty baseline so the comparison is about the engines.
      write(biomeRoot, { [BASELINE_FILE]: { version: 1, findings: {}, suppressions: {} } })

      const fromBiome = await check({ root: biomeRoot, files: ['src/a.js'] })
      const fromEslint = await check({ root: eslintRoot, files: ['src/a.js'] })
      const rules = (result: typeof fromBiome): string[] =>
        [...new Set(result.findings.map(finding => finding.rule))].filter(rule => shared.includes(rule)).sort()

      expect(fromEslint.setup).toEqual([])
      // Biome still runs in the ESLint project, but only to format.
      expect(fromEslint.engines).toEqual(['biome', 'eslint'])
      expect(fromEslint.commands).toEqual(['biome check src/a.js', 'eslint src/a.js'])
      expect(
        fromEslint.findings.filter(finding => finding.engine === 'biome' && !finding.rule.startsWith('pawl/'))
      ).toEqual([])
      expect(rules(fromEslint)).toEqual(shared)
      expect(rules(fromBiome)).toEqual(shared)
    })
  }
)

describe.runIf(existsSync(join(PACKAGE_ROOT, 'dist/cli.js')))(
  'the built CLI, under plain Node',
  { timeout: 60_000 },
  () => {
    const run = (root: string, ...args: string[]): { code: number; stdout: string; stderr: string } => {
      const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), ...args], {
        cwd: root,
        encoding: 'utf8',
        // A person's run in a pipe, even when the tests run under a coding agent.
        env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0', PAWL_FORMAT: '' }
      })

      return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
    }

    test('loads a TypeScript policy that imports definePolicy from the package', () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'pawl.config.ts':
          "import { definePolicy } from '@santi020k/pawl'\n\nexport default definePolicy({ rules: { 'no-console': 'off' } })\n",
        'src/a.ts': "console.log('hello')\n"
      })

      link(root)

      expect(run(root, 'init', '--yes', '--no-install', '--no-editor')).toMatchObject({ code: 0, stderr: '' })
      expect(json(root, 'biome.json')).toEqual({
        extends: [BIOME_PRESET],
        linter: { rules: { suspicious: { noConsole: 'off' } } }
      })
      expect(run(root, 'check')).toMatchObject({ code: 0, stdout: 'No new findings.\n' })
      expect(run(root, 'explain', 'no-console').stdout).toContain(
        'Level here:  off (set by pawl.config.ts; the standard has warn)'
      )
      expect(run(root, 'doctor')).toMatchObject({ code: 0, stdout: expect.stringContaining('No problems found.') })
    })

    test('checks only changed files, prints agent output, and exits 1 on new errors', () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'src/a.js': 'export const a = 1\n'
      })

      link(root)
      spawnSync('git', ['init', '-q'], { cwd: root })
      write(root, { '.gitignore': 'node_modules\n' })
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      spawnSync('git', ['add', '-A'], { cwd: root })
      spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: root })

      expect(run(root, 'check', '--changed', '--format', 'agent')).toMatchObject({ code: 0, stdout: '' })

      write(root, { 'src/b.js': 'debugger\n' })

      const result = run(root, 'check', '--changed', '--format', 'agent')

      expect(result.code).toBe(1)
      expect(JSON.parse(result.stdout)).toEqual({
        file: 'src/b.js',
        line: 1,
        rule: 'biome:suspicious/noDebugger',
        message: 'This is an unexpected use of the debugger statement.'
      })
    })

    test("fixes only the files an agent's hook names, and answers in the shape that agent reads", () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'src/a.js': 'export const a = 1\n'
      })
      const hook = (input: object): { code: number; stdout: string; stderr: string } => {
        const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), 'fix', '--hook'], {
          cwd: root,
          encoding: 'utf8',
          input: JSON.stringify(input),
          env: { ...process.env, CI: '', NO_COLOR: '1' }
        })

        return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
      }

      link(root)
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      write(root, { 'src/edited.js': 'export const   b = 1\ndebugger\n', 'src/other.js': 'export const   c = 1\n' })

      const claude = hook({
        hook_event_name: 'PostToolUse',
        cwd: root,
        tool_name: 'Write',
        tool_input: { file_path: join(root, 'src/edited.js') }
      })
      const context = (JSON.parse(claude.stdout) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput

      expect(claude).toMatchObject({ code: 0, stderr: '' })
      expect(context.hookEventName).toBe('PostToolUse')
      expect(context.additionalContext).toContain('1 problem left:')
      expect(context.additionalContext).toContain(
        '"file":"src/edited.js","line":2,"rule":"biome:suspicious/noDebugger"'
      )
      // The edited file is formatted. The one the agent did not touch is not.
      expect(readFileSync(join(root, 'src/edited.js'), 'utf8')).toBe('export const b = 1\ndebugger\n')
      expect(readFileSync(join(root, 'src/other.js'), 'utf8')).toBe('export const   c = 1\n')

      // Codex names its files in the patch, relative to its folder.
      const codex = hook({
        hook_event_name: 'PostToolUse',
        cwd: root,
        tool_name: 'apply_patch',
        tool_input: { command: '*** Begin Patch\n*** Update File: src/edited.js\n@@\n*** End Patch' }
      })

      expect(codex.stdout).toContain('noDebugger')
      // Copilot reads a top-level additionalContext, and its hook also runs after tools that edit nothing.
      expect(
        JSON.parse(hook({ toolName: 'edit', toolArgs: JSON.stringify({ path: 'src/edited.js' }), cwd: root }).stdout)
      ).toHaveProperty('additionalContext')
      expect(hook({ toolName: 'view', toolArgs: { path: 'src/other.js' }, cwd: root })).toEqual({
        code: 0,
        stdout: '',
        stderr: ''
      })
      // Cursor reads nothing back, so pawl fixes the file and prints nothing.
      expect(hook({ hook_event_name: 'afterFileEdit', file_path: join(root, 'src/other.js') })).toEqual({
        code: 0,
        stdout: '',
        stderr: ''
      })
      expect(readFileSync(join(root, 'src/other.js'), 'utf8')).toBe('export const c = 1\n')
      // A file outside the project is not pawl's to fix.
      expect(
        hook({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/tmp/x.js' } })
      ).toEqual({ code: 0, stdout: '', stderr: '' })
    })

    test('sends the agent back when it stops with errors left in its own edits, and no further than that', () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'src/a.js': 'export const a = 1\n'
      })
      // The hooks remember a session's edits in the temporary folder: this test gets its own.
      const state = mkdtempSync(join(tmpdir(), 'pawl-stop-'))
      const hook = (command: 'fix' | 'check', input: object): { code: number; stdout: string; stderr: string } => {
        const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), command, '--hook'], {
          cwd: root,
          encoding: 'utf8',
          input: JSON.stringify(input),
          env: { ...process.env, CI: '', NO_COLOR: '1', TMPDIR: state }
        })

        return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
      }
      const edit = (session: string, file: string) =>
        hook('fix', {
          hook_event_name: 'PostToolUse',
          session_id: session,
          cwd: root,
          tool_name: 'Write',
          tool_input: { file_path: join(root, file) }
        })
      const stop = (session: string, active: boolean) =>
        hook('check', { hook_event_name: 'Stop', session_id: session, cwd: root, stop_hook_active: active })
      const silent = { code: 0, stdout: '', stderr: '' }

      link(root)
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      // The agent edits one file. The person has a problem of their own in another, which is not the agent's.
      write(root, { 'src/edited.js': 'debugger\n', 'src/mine.js': 'debugger\n' })
      edit('s1', 'src/edited.js')

      const first = stop('s1', false)
      const back = JSON.parse(first.stdout) as { decision: string; reason: string }

      expect(first.code).toBe(0)
      expect(back.decision).toBe('block')
      expect(back.reason).toContain('You are not done yet: pawl found 1 problem')
      expect(back.reason).toContain('"file":"src/edited.js"')
      expect(back.reason).not.toContain('src/mine.js')
      // The agent changed nothing: pawl hands the rest to the person instead of going round in circles.
      expect(JSON.parse(stop('s1', true).stdout)).toEqual({
        systemMessage:
          'pawl: 1 problem left in the files the agent edited. Run "npx --no pawl check --changed" to see them.'
      })
      // The session's edits are forgotten, so the next turn starts clean.
      expect(stop('s1', false)).toEqual(silent)

      // Another session that fixes what the stop hook gave back finishes on the next stop.
      edit('s2', 'src/edited.js')
      expect(JSON.parse(stop('s2', false).stdout)).toHaveProperty('decision', 'block')
      write(root, { 'src/edited.js': 'export const edited = 1\n' })
      expect(stop('s2', true)).toEqual(silent)

      // A turn that edited nothing has nothing to check.
      expect(stop('s3', false)).toEqual(silent)

      // Cursor: the edit hook says nothing back, so what is left reaches the agent as it stops.
      write(root, { 'src/cursor.js': 'debugger\n' })
      expect(
        hook('fix', { hook_event_name: 'afterFileEdit', conversation_id: 'c1', file_path: join(root, 'src/cursor.js') })
      ).toEqual(silent)
      expect(
        hook('check', { hook_event_name: 'stop', conversation_id: 'c1', status: 'aborted', loop_count: 0 })
      ).toEqual(silent)

      const cursor = hook('check', {
        hook_event_name: 'stop',
        conversation_id: 'c1',
        status: 'completed',
        loop_count: 0
      })

      expect((JSON.parse(cursor.stdout) as { followup_message: string }).followup_message).toContain('src/cursor.js')
    })

    test('tells the person, not the agent, when the hook could not check the edit', () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'src/a.js': 'export const a = 1\n'
      })

      link(root)
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      rmSync(join(root, 'node_modules/@santi020k/pawl'))

      const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), 'fix', '--hook'], {
        cwd: root,
        encoding: 'utf8',
        input: JSON.stringify({
          hook_event_name: 'PostToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: join(root, 'src/a.js') }
        })
      })

      // 2 would hand the message to the agent. Any other failing code goes to the person.
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toMatch(
        /^pawl: biome\.json extends @santi020k\/pawl\/biome, but @santi020k\/pawl is not installed/
      )
    })

    test("explains pawl's own rules and guards, by the names its findings carry", () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module', dependencies: { openai: '^5.0.0' } }
      })

      link(root)

      expect(run(root, 'explain', 'pawl/ai-keys')).toEqual({
        code: 0,
        stderr: '',
        stdout: [
          'pawl/ai-keys',
          '  The AI client keys guard: imports and code that pawl refuses, with no plugin.',
          '',
          '  On here:     yes',
          '  Level here:  error',
          '  Checked by:  the code patterns by Biome, as rules pawl writes, or by ESLint',
          '',
          '  It refuses:',
          '    - Do not write an API key in the code. Read it from the environment or a secret store.',
          '    - dangerouslyAllowBrowser sends your API key to every visitor. Call the model from a server.',
          ''
        ].join('\n')
      })
      expect(run(root, 'explain', 'hono').stdout).toContain(
        'On here:     no. It switches on when the project depends on hono'
      )
      expect(run(root, 'explain', 'de-morgan').stdout).toContain(
        'On here:     no. Switch it on with "pawl add de-morgan"'
      )
      expect(run(root, 'explain', 'pawl/sort-package-json').stdout).toContain('How to fix:  Run "pawl fix".')
      expect(run(root, 'explain', 'pawl/no-new-disable').code).toBe(0)
      expect(run(root, 'explain', 'pawl/docker-no-root').code).toBe(0)
      expect(run(root, 'explain', 'not-a-rule')).toMatchObject({ code: 1, stderr: '' })
      // The names of an engine's own diagnostics, with no rule of the catalog behind them.
      expect(run(root, 'explain', 'eslint:parse').stdout).toContain('ESLint cannot parse the file')
      expect(run(root, 'explain', 'eslint:unused-disable-directive').stdout).toContain('switches off no finding')
      expect(run(root, 'explain', 'oxlint:parse').stdout).toContain('Oxlint cannot parse the file')
      expect(run(root, 'explain', 'biome:fs/cantRead')).toMatchObject({ code: 0 })
      expect(run(root, 'explain', 'biome:style/noDefaultExport').stdout).toContain(
        'Read more:   https://biomejs.dev/linter/rules/no-default-export/'
      )
      expect(run(root, 'explain', 'oxlint:react-perf/jsx-no-new-object-as-prop').stdout).toContain(
        'Read more:   https://oxc.rs/docs/guide/usage/linter/rules/react_perf/jsx-no-new-object-as-prop.html'
      )
      expect(run(root, 'explain', 'oxlint:jsx-a11y/alt-text').stdout).toMatch(/^jsx-a11y\/alt-text\n/)
      expect(run(root, 'explain', 'oxlint:unicorn/no-unknown-rule').stdout).toContain(
        'rules/unicorn/no-unknown-rule.html'
      )
      // The names the output prints for a rule of the catalog lead to that rule.
      for (const name of [
        'oxlint:typescript/no-floating-promises',
        'typescript/no-floating-promises',
        'eslint:@typescript-eslint/no-floating-promises'
      ]) {
        expect(run(root, 'explain', name).stdout, name).toMatch(/^@typescript-eslint\/no-floating-promises\n/)
      }

      expect(run(root, 'explain', 'oxlint:no-debugger').stdout).toMatch(/^no-debugger\n/)
      expect(run(root, 'explain', 'biome:suspicious/noDebugger').stdout).toMatch(/^no-debugger\n/)
    })

    test('names the values a choice takes when it gets one it does not know', () => {
      const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' } })

      expect(run(root, 'init', '--mode', 'weird', '--no-install')).toEqual({
        code: 2,
        stdout: '',
        stderr: 'pawl: Unknown mode "weird". Use auto, keep or biome.\n'
      })
      expect(run(root, 'init', '--formatter', 'dprint', '--no-install').stderr).toBe(
        'pawl: Unknown formatter "dprint". Use biome or prettier.\n'
      )
    })

    test('reads every option before it changes a file', () => {
      const unformatted = 'export const a = {b:1}\n'
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'src/a.js': unformatted
      })

      link(root)
      run(root, 'init', '--yes', '--no-install', '--no-editor')

      expect(run(root, 'fix', '--format', 'nope')).toEqual({
        code: 2,
        stdout: '',
        stderr: 'pawl: Unknown format "nope". Use pretty, agent, editor, github, sarif or json.\n'
      })
      expect(run(root, 'fix', '--max-warnings', 'none').code).toBe(2)
      expect(readFileSync(join(root, 'src/a.js'), 'utf8')).toBe(unformatted)

      expect(run(root, 'fix').code).toBe(0)
      expect(readFileSync(join(root, 'src/a.js'), 'utf8')).toBe('export const a = { b: 1 }\n')
    })

    test('takes any CI value but an empty one, 0 and false to mean CI', () => {
      const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' } })

      link(root)
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      // The policy changes and "pawl sync" does not run: drift, which fails only in CI.
      write(root, { 'pawl.config.json': { rules: { 'no-console': 'error' } } })

      const inCi = (value: string): number | null =>
        spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), 'check'], {
          cwd: root,
          env: { ...process.env, CI: value, GITHUB_ACTIONS: '', NO_COLOR: '1' }
        }).status

      for (const value of ['true', '1', 'True']) expect(inCi(value), value).toBe(2)

      for (const value of ['', '0', 'false']) expect(inCi(value), value).toBe(0)
    })

    test('checks every file with --changed outside a git repository', () => {
      const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' } })

      link(root)
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      write(root, { 'src/a.js': 'debugger\n' })

      const result = run(root, 'check', '--changed', '--format', 'agent')

      // No repository can say what changed. Passing with nothing checked would hide the finding.
      expect(result.code).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({ file: 'src/a.js', rule: 'biome:suspicious/noDebugger' })
    })

    test('checks only what a branch changed since a ref, and exits 2 when the ref is unknown', () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'src/a.js': 'export const a = 1\n'
      })
      const git = (...args: string[]): void => {
        spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root })
      }

      link(root)
      git('init', '-q', '-b', 'main')
      write(root, { '.gitignore': 'node_modules\n' })
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      git('add', '-A')
      git('commit', '-qm', 'init')
      git('checkout', '-qb', 'feature')

      expect(run(root, 'check', '--since', 'main')).toMatchObject({ code: 0, stdout: 'No files to check.\n' })

      write(root, { 'src/b.js': 'debugger\n' })
      git('add', '-A')
      git('commit', '-qm', 'add b')

      // What main gained after the branch left it is not the branch's work.
      git('checkout', '-q', 'main')
      write(root, { 'src/c.js': 'debugger\n' })
      git('add', '-A')
      git('commit', '-qm', 'add c')
      git('checkout', '-q', 'feature')

      const result = run(root, 'check', '--since', 'main', '--format', 'agent')

      expect(result.code).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({ file: 'src/b.js', rule: 'biome:suspicious/noDebugger' })

      const unknown = run(root, 'check', '--since', 'origin/missing')

      expect(unknown.code).toBe(2)
      expect(unknown.stdout).toContain('--since: git does not know "origin/missing".')
      expect(unknown.stdout).toContain('The check did not complete.')

      expect(run(root, 'check', '--since', 'main', '--changed')).toMatchObject({
        code: 2,
        stderr: 'pawl: Use --since or --changed, not both.\n'
      })
      expect(run(root, 'check', '--since', 'main', 'src/a.js')).toMatchObject({
        code: 2,
        stderr: 'pawl: Use --since or a list of files, not both.\n'
      })
    })

    test('gives a coding agent its own output, editors theirs, and a person the plain view in a pipe', () => {
      const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' } })

      link(root)
      run(root, 'init', '--yes', '--no-install', '--no-editor')
      write(root, { 'src/b.js': 'debugger\n' })

      // Whatever agent runs these tests, only the variable each case sets says who is running pawl.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            !/^(PAWL_AGENT|PAWL_FORMAT|AGENT|AI_AGENT|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CURSOR_AGENT|GEMINI_CLI|QWEN_CODE|CODEX_\w+|AMP_CURRENT_THREAD_ID|AUGMENT_AGENT|CLINE_ACTIVE|OPENCODE_CLIENT|ANTIGRAVITY_AGENT)$/.test(
              name
            )
        )
      )
      const as = (extra: Record<string, string>, ...args: string[]): { code: number; stdout: string } => {
        const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), ...args], {
          cwd: root,
          encoding: 'utf8',
          env: { ...env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', ...extra }
        })

        return { code: result.status ?? -1, stdout: result.stdout }
      }

      const agent = as({ CLAUDECODE: '1' }, 'check')

      expect(agent.code).toBe(1)
      expect(JSON.parse(agent.stdout)).toMatchObject({ file: 'src/b.js', line: 1, rule: 'biome:suspicious/noDebugger' })
      expect(as({ CURSOR_AGENT: '1' }, 'check', '--format', 'pretty').stdout).toContain('src/b.js:1:1  error  biome')
      expect(as({ CLAUDECODE: '1', PAWL_AGENT: '0' }, 'check').stdout).toContain('1 error.')
      expect(as({}, 'check').stdout).toContain('src/b.js:1:1  error  biome')
      // A program that reads pawl, such as Quality, asks for a format; --format still wins.
      expect(as({ CLAUDECODE: '1', PAWL_FORMAT: 'editor' }, 'check').stdout).toMatch(/^src\/b\.js:1:1: error: /)
      expect(as({ PAWL_FORMAT: 'editor' }, 'check', '--format', 'agent').stdout).toMatch(/^\{"file":"src\/b\.js"/)
      expect(as({ PAWL_FORMAT: 'xml' }, 'check').code).toBe(2)
      for (const command of ['check', 'fix']) {
        const explicit = as({ PAWL_FORMAT: 'xml' }, command, '--format', 'json')

        expect(explicit.code).toBe(1)
        expect(JSON.parse(explicit.stdout)).toMatchObject({ reportVersion: 1, setup: [] })
        expect(as({ PAWL_FORMAT: 'json' }, command, '--format', 'xml').code).toBe(2)
      }
      expect(as({}, 'check', '--format', 'editor')).toEqual({
        code: 1,
        stdout:
          'src/b.js:1:1: error: This is an unexpected use of the debugger statement. [biome:suspicious/noDebugger]\n'
      })
    })

    test('shows the help of one command, and suggests the command or option that was meant', () => {
      const root = project()
      const help = run(root, 'help', 'check').stdout

      expect(help).toContain('pawl check [files]  Lint, check formatting and apply the ratchet')
      expect(help).toContain('$ pawl check --since origin/main --ci')
      expect(help).not.toContain('Options for init')
      expect(run(root, 'check', '--help').stdout).toBe(help)
      expect(run(root, 'chek')).toMatchObject({
        code: 2,
        stderr: 'pawl: Unknown command "chek". Did you mean "pawl check"? Run "pawl --help".\n'
      })
      expect(run(root, 'check', '--chnged')).toMatchObject({
        code: 2,
        stderr: 'pawl: Unknown option "--chnged". Did you mean "--changed"? Run "pawl --help" for the options.\n'
      })
      expect(run(root, 'check', '--format')).toMatchObject({ code: 2, stderr: 'pawl: --format takes a value.\n' })
    })

    test('reports usage errors on stderr with exit code 2', () => {
      const root = project()

      expect(run(root, 'nope')).toMatchObject({ code: 2, stderr: 'pawl: Unknown command "nope". Run "pawl --help".\n' })
      // A name every object has is not a command either.
      expect(run(root, 'constructor')).toMatchObject({ code: 2, stderr: expect.stringContaining('Unknown command') })
      expect(run(root, 'check')).toMatchObject({ code: 2, stdout: expect.stringContaining('No biome.json found.') })
      expect(run(root, '--version').stdout).toMatch(/^\d+\.\d+\.\d+/)
    })
  }
)

describe('a monorepo, with the real Biome', { timeout: 60_000 }, () => {
  // A function named like a hook that calls another one conditionally: fine anywhere but React.
  const hookLike =
    'export function useColor(flag) {\n  if (flag) {\n    return useThing()\n  }\n\n  return 1\n}\n\nfunction useThing() {\n  return 2\n}\n'

  it('applies a technology only in the packages that use it', async () => {
    const root = project({
      'package.json': { name: 'mono', private: true, type: 'module' },
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
      'apps/web/package.json': { name: 'web', private: true, dependencies: { react: '^19.0.0' } },
      'apps/web/src/a.js': hookLike,
      'packages/api/package.json': { name: 'api', private: true },
      'packages/api/src/a.js': hookLike
    })

    link(root)

    const { plan } = await init(root, { editor: false })

    expect(plan.actions.map(action => action.path)).toEqual([
      'biome.json',
      '.pawl/biome-overrides.json',
      'package.json'
    ])
    expect(json(root, 'biome.json')).toMatchObject({
      extends: [BIOME_PRESET],
      overrides: [{ includes: ['apps/web/**'], linter: { domains: { react: 'recommended' } } }]
    })
    expect(existsSync(join(root, 'apps/web/biome.json'))).toBe(false)
    expect(json(root, BASELINE_FILE)).toMatchObject({
      findings: { 'apps/web/src/a.js': { 'react-hooks/rules-of-hooks': 1 } }
    })
    expect(json(root, BASELINE_FILE)).not.toHaveProperty(['findings', 'packages/api/src/a.js'])

    // Legacy inline arrays without ownership evidence need explicit reconciliation when scopes change.
    rmSync(join(root, '.pawl/biome-overrides.json'))
    write(root, { 'packages/api/package.json': { name: 'api', private: true, dependencies: { next: '^16.0.0' } } })

    const before = readFileSync(join(root, 'biome.json'), 'utf8')
    const drifted = await check({ root, fix: true })

    expect(drifted.setup).toEqual([expect.objectContaining({ code: 'biome-overrides-conflict' })])
    expect(exitCode(drifted)).toBe(2)
    expect(drifted.commands).toEqual([])
    const reconciliation = await planInit({ root, install: false, editor: false })
    expect(reconciliation.actions.some(action => action.path === 'biome.json')).toBe(false)
    applyPlan(reconciliation)
    expect(readFileSync(join(root, 'biome.json'), 'utf8')).toBe(before)

    // This fixture has only generated entries: preserve the original before explicitly regenerating them.
    write(root, { 'biome.before-scopes.json': before, 'biome.json': { extends: [BIOME_PRESET] } })
    applyPlan(await planInit({ root, install: false, editor: false }))
    expect((await check({ root })).setup).toEqual([])
    expect(readFileSync(join(root, 'biome.before-scopes.json'), 'utf8')).toBe(before)
  })

  it('adds the Turborepo rules repo-wide and leaves a hand-written package config alone', async () => {
    const root = project({
      'package.json': { name: 'mono', private: true, workspaces: ['apps/*'] },
      'turbo.json': {},
      'apps/web/package.json': { name: 'web', dependencies: { vue: '^3.5.0' } },
      'apps/web/biome.jsonc': '{\n  // ours\n  "root": false\n}\n'
    })
    const plan = await planInit({ root, install: false, editor: false })

    expect(plan.policy.engine).toBe('auto')
    expect(plan.actions.find(action => action.path === 'biome.json')).toBeDefined()
    expect(plan.actions.some(action => action.path.startsWith('apps/web/biome'))).toBe(false)
    expect(plan.notes.join(' ')).toContain('apps/web/biome.jsonc is a nested Biome config')
    applyPlan(plan)
    expect(json(root, 'biome.json')).toMatchObject({
      extends: [BIOME_PRESET, '@santi020k/pawl/biome/turbo'],
      overrides: [{ includes: ['apps/web/**'], linter: { domains: { vue: 'recommended' } } }]
    })
  })

  it('makes check and fix root tasks in a Turborepo, uncached, under the names the scripts got', async () => {
    const root = project({
      'package.json': { name: 'mono', private: true, workspaces: ['apps/*'], scripts: { check: 'tsc --noEmit' } },
      'turbo.json': { tasks: { build: { outputs: ['dist/**'] } } },
      'apps/web/package.json': { name: 'web' }
    })
    const plan = await planInit({ root, install: false, editor: false })

    applyPlan(plan)

    expect(json(root, 'package.json')).toMatchObject({
      scripts: { check: 'tsc --noEmit', 'pawl:check': 'pawl check', fix: 'pawl fix' }
    })
    expect(json(root, 'turbo.json')).toEqual({
      tasks: { build: { outputs: ['dist/**'] }, '//#pawl:check': { cache: false }, '//#fix': { cache: false } }
    })
    // A second run has nothing to add.
    expect((await planInit({ root, install: false, editor: false })).actions.map(action => action.path)).not.toContain(
      'turbo.json'
    )
  })
})

describe('hooks and agent instructions', () => {
  it('adds the check to an existing husky hook, once', async () => {
    const root = project({ 'package.json': { name: 'fixture' }, '.husky/pre-commit': 'pnpm test\n' })
    const plan = await planInit({ root, install: false, editor: false, hooks: true })

    applyPlan(plan)
    expect(readFileSync(join(root, '.husky/pre-commit'), 'utf8')).toBe('pnpm test\nnpx --no pawl check --changed\n')
    expect((await planInit({ root, install: false, editor: false, hooks: true })).actions).toEqual([])
  })

  it('swaps the pre-commit line an earlier version wrote, so a fresh clone never installs the unscoped package', async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      '.husky/pre-commit': 'pnpm test\nnpx pawl check --changed\n'
    })

    applyPlan(await planInit({ root, install: false, editor: false, hooks: true }))
    expect(readFileSync(join(root, '.husky/pre-commit'), 'utf8')).toBe('pnpm test\nnpx --no pawl check --changed\n')
    expect((await planInit({ root, install: false, editor: false, hooks: true })).actions).toEqual([])

    const clone = project({ 'package.json': { name: 'fixture' } })

    spawnSync('git', ['init', '-q'], { cwd: clone })
    write(clone, { '.git/hooks/pre-commit': '#!/bin/sh\nnpx pawl check --changed\n' })
    applyPlan(await planInit({ root: clone, install: false, editor: false, hooks: true }))
    expect(readFileSync(join(clone, '.git/hooks/pre-commit'), 'utf8')).toBe(
      '#!/bin/sh\nnpx --no pawl check --changed\n'
    )
  })

  it('points to lefthook instead of editing its YAML', async () => {
    const root = project({ 'package.json': { name: 'fixture' }, 'lefthook.yml': 'pre-commit:\n' })
    const plan = await planInit({ root, install: false, editor: false, hooks: true })

    expect(plan.actions.map(action => action.path)).toEqual([
      'biome.json',
      '.pawl/biome-overrides.json',
      'package.json'
    ])
    expect(plan.notes.join(' ')).toContain(
      'Add "npx --no pawl check --changed" to the pre-commit commands in lefthook.yml'
    )
  })

  it('writes agent instructions into a marked block and keeps the rest of AGENTS.md', async () => {
    const root = project({ 'package.json': { name: 'fixture' }, 'AGENTS.md': '# Our repo\n\nBe kind.\n' })

    applyPlan(await planInit({ root, install: false, editor: false, agents: true }))

    const written = readFileSync(join(root, 'AGENTS.md'), 'utf8')

    expect(written).toContain('# Our repo\n\nBe kind.\n\n<!-- pawl:start -->')
    expect(written).toContain('npx --no pawl check --changed --format agent')
    expect((await planInit({ root, install: false, editor: false, agents: true })).actions).toEqual([])

    // An older block is replaced in place.
    write(root, { 'AGENTS.md': '# Our repo\n\n<!-- pawl:start -->\nold\n<!-- pawl:end -->\n\n## After\n' })
    applyPlan(await planInit({ root, install: false, editor: false, agents: true }))

    const updated = readFileSync(join(root, 'AGENTS.md'), 'utf8')

    expect(updated).not.toContain('old')
    expect(updated.endsWith('<!-- pawl:end -->\n\n## After\n')).toBe(true)
  })
})

describe('Biome rule domains, with the real Biome', { timeout: 60_000 }, () => {
  const page = 'export default function Page() {\n  return <img src="/a.png" alt="a" />\n}\n'

  it('turns on the rules Biome recommends for each technology a project uses', async () => {
    const root = project({
      'package.json': {
        name: 'fixture',
        private: true,
        type: 'module',
        dependencies: { next: '^16.0.0', react: '^19.0.0', tailwindcss: '^4.0.0' },
        devDependencies: { '@playwright/test': '^1.50.0' }
      },
      'src/page.jsx': page
    })

    link(root)
    await init(root, { editor: false })

    expect(json(root, 'biome.json')).toEqual({
      extends: [
        BIOME_PRESET,
        '@santi020k/pawl/biome/react',
        '@santi020k/pawl/biome/next',
        '@santi020k/pawl/biome/tailwind',
        '@santi020k/pawl/biome/playwright'
      ]
    })
    // noImgElement belongs to Biome's Next.js domain; pawl's catalog does not list it.
    expect(json(root, BASELINE_FILE)).toMatchObject({
      findings: { 'src/page.jsx': { 'biome:performance/noImgElement': 1 } }
    })
  })

  it('leaves those rules off in a project that does not use the technology', async () => {
    const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' }, 'src/page.jsx': page })

    link(root)
    await init(root, { editor: false })
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET] })
    expect(json(root, BASELINE_FILE)).toEqual({ version: 1, findings: {}, suppressions: {}, tests: {} })
  })
})

describe("the tools are the project's choice", { timeout: 60_000 }, () => {
  it('formats with the real Prettier when the repo keeps it', async () => {
    const root = project({
      'package.json': {
        name: 'fixture',
        private: true,
        type: 'module',
        devDependencies: { eslint: '^10.0.0', prettier: '^3.0.0' }
      },
      'eslint.config.js': 'export default []\n',
      '.prettierrc.json': { semi: true },
      'src/a.js': 'export const a   = "one";\n'
    })

    link(root, { eslint: true, prettier: true })

    const plan = await planInit({ root, mode: 'keep', install: false, editor: false })

    expect(plan.engines).toEqual(['eslint'])
    expect(plan.formatter).toBe('prettier')
    expect(plan.actions.map(action => action.path)).toEqual(['pawl.config.ts', 'package.json'])
    expect(plan.notes.join(' ')).toContain(".prettierrc.json differs from the standard's style")
    applyPlan(plan)
    expect(readFileSync(join(root, 'pawl.config.ts'), 'utf8')).toContain("engine: 'eslint',\n  formatter: 'prettier'")
    expect(existsSync(join(root, 'biome.json'))).toBe(false)

    // The repo's own Prettier config decides the style until it is synced.
    const before = await check({ root, policy: plan.policy, files: ['src/a.js'] })

    expect(before.engines).toEqual(['eslint'])
    expect(before.commands).toEqual(['eslint src/a.js', 'prettier --list-different src/a.js'])
    expect(before.setup.map(issue => issue.code)).toEqual(['prettier-config-stale'])
    expect(before.findings).toEqual([
      expect.objectContaining({ file: 'src/a.js', engine: 'prettier', rule: 'pawl/format', fixable: true })
    ])

    await check({ root, policy: plan.policy, files: ['src/a.js'], fix: true })
    expect(readFileSync(join(root, 'src/a.js'), 'utf8')).toBe('export const a = "one";\n')
    expect((await check({ root, policy: plan.policy, files: ['src/a.js'] })).findings).toEqual([])
  })

  it('lets Biome lint while Prettier formats', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/a.js': 'var a   = 1\nexport { a }\n'
    })

    link(root, { prettier: true })

    const plan = await planInit({ root, formatter: 'prettier', install: false, editor: false })

    expect(plan.actions.map(action => action.path)).toEqual([
      'pawl.config.ts',
      'biome.json',
      '.pawl/biome-overrides.json',
      '.prettierrc.json',
      'package.json'
    ])
    applyPlan(plan)
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET], formatter: { enabled: false } })
    expect(json(root, '.prettierrc.json')).toEqual({
      printWidth: 120,
      useTabs: false,
      tabWidth: 2,
      semi: false,
      singleQuote: true,
      trailingComma: 'none',
      arrowParens: 'avoid'
    })

    const result = await check({ root, policy: plan.policy, files: ['src/a.js'] })

    expect(result.setup).toEqual([])
    expect(result.findings.map(finding => `${finding.engine} ${finding.rule}`).sort()).toEqual([
      'biome no-var',
      'biome pawl/organize-imports',
      'prettier pawl/format'
    ])
  })

  it('adds a pack: the plugin to install, an ESLint config, and the policy entry when the pack is opt-in', async () => {
    const root = project({ 'package.json': { name: 'fixture', private: true, dependencies: { zod: '^4.0.0' } } })
    const plan = await planInit({ root, install: false, editor: false })

    expect(plan.notes.join(' ')).toContain('Optional packs that fit this project: zod.')
    expect(plan.packages).toEqual(['@santi020k/pawl', '@biomejs/biome'])

    const add = await planAdd(root, ['zod', 'unicorn'], false)

    expect(add.actions.map(action => action.path)).toEqual(['eslint.config.js', 'pawl.config.ts', 'package.json'])
    applyPlan(add)
    expect(readFileSync(join(root, 'pawl.config.ts'), 'utf8')).toContain("packs: ['unicorn']")
    expect(json(root, 'package.json')).toMatchObject({
      devDependencies: { eslint: '^10.0.0', 'eslint-plugin-zod': '^5.0.0', 'eslint-plugin-unicorn': '^77.0.0' }
    })
    await expect(planAdd(root, ['nope'])).rejects.toThrow(/Unknown pack: nope/)
  })

  it('installs typescript-eslint with ESLint next to Biome in a TypeScript project, so its scripts parse', async () => {
    // ESLint lints the scripts for any pack, and without typescript-eslint's parser it fails on every type.
    const root = project({
      'package.json': { name: 'fixture', private: true, devDependencies: { typescript: '^5.9.0' } },
      'tsconfig.json': { include: ['src'] }
    })

    expect((await planAdd(root, ['yaml'])).install).toBe('npm install -D eslint typescript-eslint eslint-plugin-yml')
    expect((await planInit({ root, packs: ['markdown'] })).install).toBe(
      'npm install -D --save-exact @biomejs/biome@2.6.8 && npm install -D @santi020k/pawl eslint typescript-eslint @eslint/markdown'
    )

    // Biome does not fully lint Vue, so the default init runs ESLint next to it.
    const vue = project({
      'package.json': { name: 'fixture', private: true, dependencies: { vue: '^3.5.0' } },
      'tsconfig.json': { include: ['src'] }
    })

    expect((await planInit({ root: vue })).install).toBe(
      'npm install -D --save-exact @biomejs/biome@2.6.8 && npm install -D @santi020k/pawl eslint typescript-eslint'
    )
  })
})

describe('guards for the libraries a project uses, with the real Biome', { timeout: 60_000 }, () => {
  it('refuses internal imports of an AI library, with no plugin to install', async () => {
    const root = project({
      'package.json': { name: 'fixture', type: 'module', dependencies: { langchain: '^1.0.0' } },
      'src/a.js': "import { thing } from 'langchain/dist/internal.js'\n\nexport const other = thing\n",
      'src/b.js': "import { ok } from 'langchain/chains'\n\nexport const fine = ok\n"
    })

    link(root)

    const plan = await planInit({ root, install: false, editor: false })

    applyPlan(plan)

    const result = await check({ root })
    const restricted = result.findings.filter(finding => finding.engineRule.endsWith('noRestrictedImports'))

    expect(result.setup).toEqual([])
    expect(restricted.map(finding => [finding.file, finding.severity])).toEqual([['src/a.js', 'error']])
    expect(restricted[0]?.message).toContain('documented entry points')
    expect(json(root, 'biome.json')).toMatchObject({
      linter: { rules: { style: { noRestrictedImports: { level: 'error' } } } }
    })
  })
})

describe("rules of pawl's own, run by the real Biome", { timeout: 60_000 }, () => {
  const KEYS = `import OpenAI from 'openai'

export const bad = new OpenAI({ apiKey: 'sk-proj-1234567890abcdef', dangerouslyAllowBrowser: true })
export const good = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, dangerouslyAllowBrowser: false })
export const empty = { apiKey: '' }
export const built = { apiKey: \`\${process.env.PREFIX}-suffix-long\` }
`
  const LOGIC = `export const pick = (a, b, context) => {
  if (!(a && b)) return 1

  context.header('Access-Control-Allow-Origin', '*')
  context.header('Access-Control-Allow-Origin', 'https://a.dev')

  return !a
}
`

  it('catches a key in the code and an open browser client, and nothing next to them', async () => {
    const root = project({
      'package.json': { name: 'fixture', type: 'module', dependencies: { openai: '^6.0.0', hono: '^4.0.0' } },
      'pawl.config.json': { packs: ['de-morgan'] },
      'src/keys.js': KEYS,
      'src/logic.js': LOGIC
    })

    link(root)

    const plan = await planInit({ root, install: false, editor: false })

    applyPlan(plan)

    expect(plan.actions.map(action => action.path)).toEqual(
      expect.arrayContaining(['.pawl/rules/ai-keys.grit', '.pawl/rules/hono.grit', '.pawl/rules/de-morgan.grit'])
    )
    expect(json(root, 'biome.json')).toMatchObject({
      plugins: ['./.pawl/rules/ai-keys.grit', './.pawl/rules/hono.grit', './.pawl/rules/de-morgan.grit']
    })

    const result = await check({ root })
    const own = result.findings.filter(finding => /^pawl\/(ai-keys|hono|de-morgan)$/.test(finding.rule))

    expect(result.setup).toEqual([])
    expect(own.map(finding => `${finding.file}:${finding.line} ${finding.rule} ${finding.severity}`)).toEqual([
      'src/keys.js:3 pawl/ai-keys error',
      'src/keys.js:3 pawl/ai-keys error',
      'src/logic.js:2 pawl/de-morgan warn',
      'src/logic.js:4 pawl/hono error'
    ])
  })

  it('says so when a rule file is gone, and shares root rule files across packages', async () => {
    const root = project({
      'package.json': { name: 'mono', private: true, workspaces: ['apps/*'], dependencies: { openai: '^6.0.0' } },
      'apps/web/package.json': { name: 'web', dependencies: { react: '^19.0.0' } },
      'apps/web/src/a.jsx': "export const client = { apiKey: 'sk-proj-1234567890abcdef' }\n"
    })

    link(root)
    applyPlan(await planInit({ root, install: false, editor: false }))

    expect(existsSync(join(root, 'apps/web/.pawl/rules/ai-keys.grit'))).toBe(false)
    expect(existsSync(join(root, '.pawl/rules/ai-keys.grit'))).toBe(true)

    const found = (await check({ root })).findings.filter(finding => finding.rule === 'pawl/ai-keys')

    expect(found.map(finding => finding.file)).toEqual(['apps/web/src/a.jsx'])

    write(root, { '.pawl/rules/ai-keys.grit': '// edited\n' })

    expect((await check({ root })).setup.map(issue => issue.message)).toContain(
      ".pawl/rules/ai-keys.grit, one of pawl's own rules for Biome, is out of date."
    )
  })
})
