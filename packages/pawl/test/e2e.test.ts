import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, it as test } from 'vitest'
import { BASELINE_FILE } from '../src/baseline.ts'
import { check, exitCode } from '../src/check.ts'
import { BIOME_PRESET, BIOME_REACT_PRESET } from '../src/engines/biome.ts'
import { applyInit, formatWritten, planAdd, planInit, recordBaseline } from '../src/init.ts'
import { formatAgent } from '../src/output.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const json = (root: string, file: string): unknown => JSON.parse(readFileSync(join(root, file), 'utf8'))

const init = async (root: string, options: Parameters<typeof planInit>[0] | object = {}) => {
  const plan = await planInit({ root, install: false, ...options })

  applyInit(plan)
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
      'package.json',
      '.vscode/settings.json',
      '.vscode/extensions.json'
    ])
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET] })
    expect(json(root, 'package.json')).toMatchObject({
      scripts: { check: 'pawl check', fix: 'pawl fix' },
      devDependencies: { '@santi020k/pawl': '^0.0.0' }
    })
    expect(baselined).toBe(3)
    expect(json(root, BASELINE_FILE)).toEqual({
      version: 1,
      findings: { 'src/old.ts': { '@typescript-eslint/no-explicit-any': 1, eqeqeq: 1, 'no-var': 1 } },
      suppressions: { 'src/old.ts': 1 }
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
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET, BIOME_REACT_PRESET] })
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

    expect(plan.actions.map(action => `${action.kind} ${action.path}`)).toEqual(['update biome.json'])
    applyInit(plan)
    await formatWritten(root, ['biome.json'])
    expect(json(root, 'biome.json')).toEqual({
      extends: [BIOME_PRESET, BIOME_REACT_PRESET],
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
    expect(plan.actions.map(action => action.path)).toEqual(['pawl.config.ts', 'biome.json', 'package.json'])
    applyInit(plan)
    expect(readFileSync(join(root, 'pawl.config.ts'), 'utf8')).toContain("engine: 'eslint'")
    // ESLint lints, so Biome is only there to format.
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET], linter: { enabled: false } })
    expect(json(root, 'package.json')).toMatchObject({
      devDependencies: {
        '@santi020k/pawl': '^0.0.0',
        '@biomejs/biome': '2.6.8',
        eslint: '^10.0.0',
        '@eslint/js': '^10.0.0'
      }
    })
  })

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
      'eslint.config.js',
      'package.json',
      '.vscode/settings.json',
      '.vscode/extensions.json',
      '.github/workflows/pawl.yml',
      '.claude/settings.json',
      'AGENTS.md'
    ])
    expect(plan.notes.join(' ')).toContain('covers all 1 package.')

    applyInit(plan)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toContain("import { eslint } from '@santi020k/pawl'")
    expect(readFileSync(join(root, '.github/workflows/pawl.yml'), 'utf8')).toContain('pnpm install --frozen-lockfile')
    expect(json(root, '.claude/settings.json')).toMatchObject({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [{ type: 'command', command: 'npx pawl check --changed --format agent' }]
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
        env: { ...process.env, CI: '', NO_COLOR: '1' }
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

    test('reports usage errors on stderr with exit code 2', () => {
      const root = project()

      expect(run(root, 'nope')).toMatchObject({ code: 2, stderr: 'pawl: Unknown command "nope". Run "pawl --help".\n' })
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

    expect(plan.actions.map(action => action.path)).toEqual(['biome.json', 'apps/web/biome.json', 'package.json'])
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET] })
    expect(json(root, 'apps/web/biome.json')).toEqual({
      root: false,
      extends: ['../../biome.json', BIOME_REACT_PRESET]
    })
    expect(json(root, BASELINE_FILE)).toMatchObject({
      findings: { 'apps/web/src/a.js': { 'react-hooks/rules-of-hooks': 1 } }
    })
    expect(json(root, BASELINE_FILE)).not.toHaveProperty(['findings', 'packages/api/src/a.js'])

    // A package that starts using React is reported until the config is synced.
    write(root, { 'packages/api/package.json': { name: 'api', private: true, dependencies: { next: '^16.0.0' } } })

    const drifted = await check({ root })

    expect(drifted.setup).toEqual([
      expect.objectContaining({
        code: 'biome-config-stale',
        message: expect.stringContaining('packages/api/biome.json is missing')
      })
    ])
    expect((await planInit({ root, install: false, editor: false })).actions.map(action => action.path)).toEqual([
      'packages/api/biome.json'
    ])
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
    expect(plan.notes.join(' ')).toContain('apps/web/biome.jsonc has comments')
    applyInit(plan)
    expect(json(root, 'biome.json')).toEqual({ extends: [BIOME_PRESET, '@santi020k/pawl/biome/turbo'] })
  })

  it('makes check and fix root tasks in a Turborepo, uncached, under the names the scripts got', async () => {
    const root = project({
      'package.json': { name: 'mono', private: true, workspaces: ['apps/*'], scripts: { check: 'tsc --noEmit' } },
      'turbo.json': { tasks: { build: { outputs: ['dist/**'] } } },
      'apps/web/package.json': { name: 'web' }
    })
    const plan = await planInit({ root, install: false, editor: false })

    applyInit(plan)

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

    applyInit(plan)
    expect(readFileSync(join(root, '.husky/pre-commit'), 'utf8')).toBe('pnpm test\nnpx pawl check --changed\n')
    expect((await planInit({ root, install: false, editor: false, hooks: true })).actions).toEqual([])
  })

  it('points to lefthook instead of editing its YAML', async () => {
    const root = project({ 'package.json': { name: 'fixture' }, 'lefthook.yml': 'pre-commit:\n' })
    const plan = await planInit({ root, install: false, editor: false, hooks: true })

    expect(plan.actions.map(action => action.path)).toEqual(['biome.json', 'package.json'])
    expect(plan.notes.join(' ')).toContain('Add "npx pawl check --changed" to the pre-commit commands in lefthook.yml')
  })

  it('writes agent instructions into a marked block and keeps the rest of AGENTS.md', async () => {
    const root = project({ 'package.json': { name: 'fixture' }, 'AGENTS.md': '# Our repo\n\nBe kind.\n' })

    applyInit(await planInit({ root, install: false, editor: false, agents: true }))

    const written = readFileSync(join(root, 'AGENTS.md'), 'utf8')

    expect(written).toContain('# Our repo\n\nBe kind.\n\n<!-- pawl:start -->')
    expect(written).toContain('npx pawl check --changed --format agent')
    expect((await planInit({ root, install: false, editor: false, agents: true })).actions).toEqual([])

    // An older block is replaced in place.
    write(root, { 'AGENTS.md': '# Our repo\n\n<!-- pawl:start -->\nold\n<!-- pawl:end -->\n\n## After\n' })
    applyInit(await planInit({ root, install: false, editor: false, agents: true }))

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
    expect(json(root, BASELINE_FILE)).toEqual({ version: 1, findings: {}, suppressions: {} })
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
    applyInit(plan)
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
      '.prettierrc.json',
      'package.json'
    ])
    applyInit(plan)
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
    applyInit(add)
    expect(readFileSync(join(root, 'pawl.config.ts'), 'utf8')).toContain("packs: ['unicorn']")
    expect(json(root, 'package.json')).toMatchObject({
      devDependencies: { eslint: '^10.0.0', 'eslint-plugin-zod': '^5.0.0', 'eslint-plugin-unicorn': '^77.0.0' }
    })
    await expect(planAdd(root, ['nope'])).rejects.toThrow(/Unknown pack: nope/)
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

    applyInit(plan)

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

    applyInit(plan)

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

  it('says so when a rule file is gone, and puts a copy next to a package config of its own', async () => {
    const root = project({
      'package.json': { name: 'mono', private: true, workspaces: ['apps/*'], dependencies: { openai: '^6.0.0' } },
      'apps/web/package.json': { name: 'web', dependencies: { react: '^19.0.0' } },
      'apps/web/src/a.jsx': "export const client = { apiKey: 'sk-proj-1234567890abcdef' }\n"
    })

    link(root)
    applyInit(await planInit({ root, install: false, editor: false }))

    expect(existsSync(join(root, 'apps/web/.pawl/rules/ai-keys.grit'))).toBe(true)

    const found = (await check({ root })).findings.filter(finding => finding.rule === 'pawl/ai-keys')

    expect(found.map(finding => finding.file)).toEqual(['apps/web/src/a.jsx'])

    write(root, { '.pawl/rules/ai-keys.grit': '// edited\n' })

    expect((await check({ root })).setup.map(issue => issue.message)).toContain(
      ".pawl/rules/ai-keys.grit, one of pawl's own rules for Biome, is out of date."
    )
  })
})
