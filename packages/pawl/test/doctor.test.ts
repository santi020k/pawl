import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, it as test } from 'vitest'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { BIOME_VERSION } from '../src/engines/biome/config.ts'
import { type DoctorReport, doctor, formatDoctor } from '../src/report/doctor.ts'
import { formatWritten, planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, PACKAGE_ROOT, project, withoutTsgolint, write } from './helpers.ts'

const ready = async (files: Record<string, string | object> = {}): Promise<string> => {
  const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' }, ...files })

  link(root)

  const plan = await planInit({ root, install: false, editor: false })

  applyPlan(plan)
  // As init does: pawl formats what it wrote, so its own files pass its own check.
  await formatWritten(
    root,
    plan.actions.map(action => action.path)
  )

  return root
}

/** A TypeScript project on Oxlint without oxlint-tsgolint, as one set up before pawl added it. */
const oxlintProject = async (files: Record<string, string | object> = {}): Promise<string> => {
  const root = project({
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'tsconfig.json': { compilerOptions: { strict: true } },
    'pawl.config.json': { engine: 'oxlint', strict: true },
    ...files
  })

  link(root)
  applyPlan(await planInit({ root, engine: 'oxlint', install: false, editor: false }))
  await withoutTsgolint(root)

  return root
}

describe('pawl doctor, with Oxlint', () => {
  it('names the rules Oxlint cannot enforce, and what would give them to it', async () => {
    const report = await doctor(await oxlintProject())
    const gaps = report.engines.oxlint?.notEnforced ?? []

    expect(gaps.filter(gap => gap.needs === 'oxlint-tsgolint').map(gap => gap.rule)).toEqual([
      '@typescript-eslint/await-thenable',
      '@typescript-eslint/consistent-type-exports',
      '@typescript-eslint/no-deprecated',
      '@typescript-eslint/no-floating-promises',
      '@typescript-eslint/no-misused-promises',
      '@typescript-eslint/no-unnecessary-type-assertion',
      '@typescript-eslint/no-unsafe-return',
      '@typescript-eslint/prefer-nullish-coalescing',
      '@typescript-eslint/prefer-optional-chain'
    ])
    expect(gaps.filter(gap => gap.needs === 'no Oxlint equivalent').map(gap => gap.rule)).toEqual([
      'import/no-extraneous-dependencies',
      'import/no-unresolved',
      'markdown/fenced-code-language',
      'markdown/heading-increment',
      'no-undef-init',
      'unused-imports/no-unused-imports',
      'yml/no-empty-sequence-entry'
    ])
    expect(gaps.some(gap => gap.rule.startsWith('pawl/') || gap.rule.startsWith('biome:'))).toBe(false)
  })

  it('counts the gap a package closes as a problem, and a rule Oxlint does not have as a note', async () => {
    const report = await doctor(await oxlintProject())
    const text = formatDoctor(report)

    expect(report.problems).toEqual([
      'Not enforced by Oxlint: @typescript-eslint/await-thenable, @typescript-eslint/consistent-type-exports, @typescript-eslint/no-deprecated and 6 more (install oxlint-tsgolint).'
    ])
    expect(text).toContain(
      'Problem: Not enforced by Oxlint: @typescript-eslint/await-thenable, @typescript-eslint/consistent-type-exports, @typescript-eslint/no-deprecated and 6 more (install oxlint-tsgolint).'
    )
    expect(text).toContain(
      '          not enforced, no Oxlint equivalent: import/no-extraneous-dependencies, import/no-unresolved, markdown/fenced-code-language and 4 more'
    )
    expect(text).not.toContain('Problem: Not enforced by Oxlint: import')
  })

  it('does not ask a project without TypeScript for the type-aware rules', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'oxlint', strict: true }
    })

    link(root)
    applyPlan(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    const report = await doctor(root)

    expect(report.problems).toEqual([])
    expect(report.engines.oxlint?.notEnforced.filter(gap => gap.rule.startsWith('@typescript-eslint/'))).toEqual([])
    expect(report.engines.oxlint?.notEnforced.length).toBeGreaterThan(0)
  })

  it('leaves out what ESLint next to Oxlint takes, and does not name it twice', async () => {
    const report = await doctor(await oxlintProject({ 'eslint.config.js': 'export default []\n' }))
    const rules = (report.engines.oxlint?.notEnforced ?? []).map(gap => gap.rule)

    // ESLint takes the core rule Oxlint has no equivalent for. The rules whose plugin it cannot load
    // are already a problem of ESLint's, with the plugin to install.
    expect(rules).not.toContain('no-undef-init')
    expect(report.problems.some(problem => problem.startsWith('Not enforced by ESLint'))).toBe(true)
    expect(report.problems.some(problem => problem.startsWith('Not enforced by Oxlint'))).toBe(false)
  })

  it('asks for tsgolint without strict mode too, for the type-aware rules the standard has on by default', async () => {
    const report = await doctor(await oxlintProject({ 'pawl.config.json': { engine: 'oxlint' } }))

    expect(report.problems).toEqual([
      'Not enforced by Oxlint: @typescript-eslint/consistent-type-exports, @typescript-eslint/no-deprecated, @typescript-eslint/prefer-optional-chain (install oxlint-tsgolint).'
    ])
  })

  it('asks for tsgolint at the root when only a workspace package declares it, and does not stop the check', async () => {
    const root = await oxlintProject({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'packages/a/package.json': { name: 'a', devDependencies: { 'oxlint-tsgolint': '*' } }
    })
    const report = await doctor(root)

    expect(report.problems).toEqual([
      'Not enforced by Oxlint: @typescript-eslint/await-thenable, @typescript-eslint/consistent-type-exports, @typescript-eslint/no-deprecated and 6 more (add oxlint-tsgolint to the devDependencies of the root package.json).'
    ])
    expect((await check({ root })).setup.map(issue => issue.code)).not.toContain('tsgolint-missing')
  })

  it('says to install the dependencies when init added tsgolint and the install has not run', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'tsconfig.json': { compilerOptions: { strict: true } },
      'pawl.config.json': { engine: 'oxlint', strict: true }
    })

    link(root)
    applyPlan(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    const report = await doctor(root)

    expect(report.problems).toEqual([
      'oxlint-tsgolint is a dependency of this project but is not installed. Install the dependencies.'
    ])
    expect(report.engines.oxlint?.notEnforced.filter(gap => gap.needs === 'oxlint-tsgolint')).toEqual([])
  })
})

describe('pawl doctor', () => {
  it('names a pattern whose brackets match no file, but would as a character class', async () => {
    const root = await ready({
      'pawl.config.json': {
        // Braces are read as a glob reads them, so they need no note.
        ignore: ['legacy/v[0-9]', 'src/app/[slug]', 'later/[id]', 'tools/*.{gen,auto}.js'],
        overrides: [{ files: ['**/*.min.[jc]s'], rules: { 'no-console': 'off' } }]
      },
      'legacy/v1/a.js': 'export const a = 1\n',
      'src/app/[slug]/page.js': 'export const b = 1\n',
      'public/app.min.js': 'export const c = 1\n',
      'tools/a.gen.js': 'export const d = 1\n'
    })

    // The route folder is there as it is written, and the pattern no file matches either way is left alone.
    expect((await doctor(root)).problems).toEqual([
      '"legacy/v[0-9]" in ignore matches no file: pawl reads brackets as the characters themselves. As a character class it would match legacy/v1/a.js, so list the paths it should match instead.',
      '"**/*.min.[jc]s" in the files of an override matches no file: pawl reads brackets as the characters themselves. As a character class it would match public/app.min.js, so list the paths it should match instead.'
    ])
  })

  it('reports the setup, the tool versions and the packs the files call for', async () => {
    const report = await doctor(await ready({ 'README.md': '# fixture\n', '.github/workflows/ci.yml': 'on: push\n' }))

    expect(report.problems).toEqual([])
    expect(report.linter).toBe('biome')
    expect(report.project.runtimes).toEqual(['node', 'browser'])
    expect(report.engines.biome).toEqual({ installed: true, config: 'biome.json', status: 'ok' })
    expect(report.compatibility).toEqual([
      { name: 'node', wanted: '>=22.18.0', installed: process.versions.node, ok: true },
      { name: '@biomejs/biome', wanted: BIOME_VERSION, installed: BIOME_VERSION, ok: true }
    ])
    expect(report.suggestedPacks).toEqual(['markdown', 'yaml'])
    expect(formatDoctor(report)).toContain(
      'Suggest:  markdown, yaml for the files in this repo (pawl add markdown yaml)'
    )
    expect(formatDoctor(report)).toContain(`Biome:    ${BIOME_VERSION}, biome.json in line with the policy`)
  })

  it('reports a project that does not have pawl itself installed, as the check does', async () => {
    // A biome.json that extends the standard, and no install: pawl ran through npx, or the clone is fresh.
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      'src/a.js': 'debugger\n'
    })
    const result = await check({ root })

    expect(result.setup).toEqual([
      {
        code: 'pawl-missing',
        message:
          'biome.json extends @santi020k/pawl/biome, but @santi020k/pawl is not installed in this project, so Biome cannot load the standard.',
        fix: 'Add @santi020k/pawl to devDependencies and install.'
      }
    ])
    expect(result.commands).toEqual([])
    expect(exitCode(result)).toBe(2)
    expect((await doctor(root)).problems).toEqual([
      'biome.json extends @santi020k/pawl/biome, but @santi020k/pawl is not installed in this project. Add it to devDependencies and install.'
    ])

    link(root)

    expect((await check({ root })).setup).toEqual([])
    expect((await doctor(root)).problems).toEqual([])
  })

  it('names a missing plugin once, however many rules wait on it', async () => {
    // ESLint lints alone, and none of the plugins the standard's rules come from is installed.
    const root = await ready({ 'pawl.config.json': { engine: 'eslint' } })
    const report = await doctor(root)
    const unicorn = report.problems.filter(problem => problem.includes('eslint-plugin-unicorn'))
    const waiting = report.engines.eslint?.notEnforced.filter(item => item.needs === 'eslint-plugin-unicorn') ?? []

    expect(waiting.length).toBeGreaterThan(4)
    expect(unicorn).toEqual([
      `Not enforced by ESLint: ${waiting
        .slice(0, 3)
        .map(item => item.rule)
        .join(', ')} and ${waiting.length - 3} more (install eslint-plugin-unicorn).`
    ])
    // A plugin one rule waits on still names that rule.
    expect(report.problems).toContain(
      'Not enforced by ESLint: unused-imports/no-unused-imports (install eslint-plugin-unused-imports).'
    )
  })

  it('reports a baseline that cannot be read', async () => {
    const root = await ready({ '.pawl/baseline.json': '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> feature\n' })
    const report = await doctor(root)

    expect(report.baseline).toEqual({ missing: 'unreadable' })
    expect(report.problems).toEqual([
      '.pawl/baseline.json cannot be read: it is not valid JSON, or not a baseline this version of pawl knows. Resolve the merge conflict in it, or run "pawl baseline" to record the findings again.'
    ])
    expect(formatDoctor(report)).toContain('Baseline: none (unreadable)')
  })

  it('reports the same setup problems the check does, such as a package config pawl has not written yet', async () => {
    const root = await ready({ 'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n' })

    write(root, { 'apps/web/package.json': { name: 'web', dependencies: { react: '^19' } } })

    const report = await doctor(root)
    const result = await check({ root })
    const stale = 'apps/web/biome.json is missing, so the rules for what that package uses are not applied there.'

    expect(result.setup).toContainEqual({ code: 'biome-config-stale', message: stale, fix: 'Run "pawl sync".' })
    expect(report.problems).toContain(`${stale} Run "pawl sync".`)
  })

  it('reports a Biome other than the one pawl pins, and an ESLint older than it supports', async () => {
    const root = await ready({
      'pawl.config.json': { engine: 'eslint' },
      'node_modules/@biomejs/biome/package.json': { name: '@biomejs/biome', version: '2.5.0' },
      'node_modules/@biomejs/biome/bin/biome': '',
      'node_modules/eslint/package.json': { name: 'eslint', version: '8.57.0' },
      'node_modules/eslint/bin/eslint.js': ''
    })
    const report = await doctor(root)

    expect(report.compatibility).toContainEqual({
      name: '@biomejs/biome',
      wanted: BIOME_VERSION,
      installed: '2.5.0',
      ok: false
    })
    expect(report.problems).toContain(
      `@biomejs/biome 2.5.0 is not a version pawl works with (${BIOME_VERSION}). Install @biomejs/biome@${BIOME_VERSION}.`
    )
    expect(report.problems).toContain(
      'eslint 8.57.0 is not a version pawl works with (>=9.22.0). Install eslint@">=9.22.0".'
    )
  })
})

describe('pawl init', () => {
  it('suggests the packs the files call for, along with the ones the dependencies do', async () => {
    const root = project({ 'package.json': { name: 'fixture', dependencies: { zod: '4' } }, 'docs/guide.md': '# hi\n' })
    const plan = await planInit({ root, install: false, editor: false })

    expect(plan.notes).toContain(
      'Optional packs that fit this project: zod markdown. Each needs an ESLint plugin. Add them with "pawl add zod markdown".'
    )
  })
})

describe.runIf(existsSync(join(PACKAGE_ROOT, 'dist/cli.js')))('the CLI', { timeout: 60_000 }, () => {
  const run = (root: string, ...args: string[]) => {
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CI: '', NO_COLOR: '1' }
    })

    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }

  test('prints the doctor report as JSON for CI, and refuses the agent format for it', async () => {
    const root = await ready()
    const result = run(root, 'doctor', '--format', 'json')
    const report = JSON.parse(result.stdout) as DoctorReport

    expect(result.code).toBe(0)
    expect(report).toMatchObject({ problems: [], linter: 'biome', formatter: 'biome' })
    expect(run(root, 'doctor', '--format', 'agent')).toMatchObject({
      code: 2,
      stderr: 'pawl: Unknown format "agent" for doctor. Use pretty or json.\n'
    })
  })

  test('fails on more warnings than --max-warnings allows, and on a limit that is not a number', async () => {
    const root = await ready({ 'src/a.js': "console.log('hi')\n", '.pawl/baseline.json': { version: 1, findings: {} } })

    expect(run(root, 'check').code).toBe(0)
    expect(run(root, 'check', '--max-warnings', '1').code).toBe(0)
    expect(run(root, 'check', '--max-warnings', '0')).toMatchObject({
      code: 1,
      stdout: expect.stringContaining('The limit is 0 warnings, so the warnings fail the check.')
    })
    expect(run(root, 'check', '--max-warnings', 'many')).toMatchObject({
      code: 2,
      stderr: 'pawl: --max-warnings takes a whole number, such as 0. Got "many".\n'
    })
  })
})
